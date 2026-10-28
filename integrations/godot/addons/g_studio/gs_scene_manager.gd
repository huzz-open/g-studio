@tool
extends RefCounted
## Orchestrates bidirectional sync between .gs files and Godot scenes.
##
## Design invariants:
##   - .gs changes -> .tscn disk is ALWAYS updated (no stale .tscn)
##   - .tscn saved -> .gs is updated (reverse sync)
##   - Manual nodes (Player, Light2D, etc.) are never lost
##   - Assumption: user does not have unsaved changes on both sides simultaneously

const SceneRegionHandler = preload("handlers/scene_region_handler.gd")

var _handlers: Dictionary = {}
var _self_written: Dictionary = {}
var _last_known_versions: Dictionary = {}
var _pending_syncs: Dictionary = {}
var _skip_next_save_back: bool = false
var _tracked_gs: Dictionary = {}


func _init() -> void:
	_handlers[1] = SceneRegionHandler.new()


# --- .gs file polling (replaces gs_file_watcher.gd) ---

func poll_gs_changes() -> void:
	var current: Dictionary = {}
	_walk_dir("res://", current)

	for path in current:
		var mtime = current[path]
		if not _tracked_gs.has(path) or _tracked_gs[path] != mtime:
			_tracked_gs[path] = mtime
			on_gs_changed(path)

	for path in _tracked_gs.keys():
		if not current.has(path):
			_tracked_gs.erase(path)


func _walk_dir(dir_path: String, out: Dictionary) -> void:
	var dir = DirAccess.open(dir_path)
	if not dir:
		return
	dir.list_dir_begin()
	var fname = dir.get_next()
	while fname != "":
		if dir.current_is_dir():
			if not fname.begins_with(".") and fname != "addons":
				_walk_dir(dir_path.path_join(fname), out)
		elif fname.ends_with(".gs"):
			var full = dir_path.path_join(fname)
			out[full] = FileAccess.get_modified_time(full)
		fname = dir.get_next()
	dir.list_dir_end()


# --- Forward sync: .gs -> .tscn ---

func initial_sync() -> void:
	_walk_dir("res://", _tracked_gs)

	var created: int = 0
	var updated: int = 0
	var pending: int = 0
	var open_scenes = EditorInterface.get_open_scenes()

	for gs_path in _tracked_gs:
		var tscn_path = gs_path.replace(".gs", ".tscn")
		if not FileAccess.file_exists(tscn_path):
			if _create_tscn_from_gs(gs_path):
				_notify_file_changed(tscn_path)
				created += 1
		elif FileAccess.get_modified_time(gs_path) > FileAccess.get_modified_time(tscn_path):
			if _is_path_in_list(tscn_path, open_scenes):
				_pending_syncs[tscn_path] = gs_path
				pending += 1
			else:
				if _update_tscn_from_gs(gs_path, tscn_path):
					_notify_file_changed(tscn_path)
					updated += 1

	if created > 0 or updated > 0 or pending > 0:
		print("[G-Studio] Initial sync: created=%d, updated=%d, pending=%d" % [created, updated, pending])

	var edited = EditorInterface.get_edited_scene_root()
	if edited != null and not edited.scene_file_path.is_empty():
		_try_apply_pending(edited)


func on_gs_changed(gs_path: String) -> void:
	if _is_self_written(gs_path):
		return

	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return

	_last_known_versions[gs_path] = gs_data.get("version", 0)
	_ensure_groups_for_gs(gs_data)

	var tscn_path = gs_path.replace(".gs", ".tscn")
	var data: Dictionary = gs_data.get("data", {})
	var regions: Array = data.get("regions", [])
	var texture_path = _resolve_texture(gs_path, data.get("texture", ""))

	if not FileAccess.file_exists(tscn_path):
		_create_tscn_from_gs(gs_path)
		_notify_file_changed(tscn_path)
		print("[G-Studio] Created: ", tscn_path)
		return

	var edited = EditorInterface.get_edited_scene_root()
	if edited != null and edited.scene_file_path == tscn_path:
		handler.apply(regions, edited, texture_path)
		_skip_next_save_back = true
		EditorInterface.save_scene()
		print("[G-Studio] Applied + saved: ", tscn_path)
		return

	var open_scenes = EditorInterface.get_open_scenes()
	if _is_path_in_list(tscn_path, open_scenes):
		_pending_syncs[tscn_path] = gs_path
		print("[G-Studio] Queued pending: ", tscn_path)
		return

	_update_tscn_from_gs(gs_path, tscn_path)
	_notify_file_changed(tscn_path)
	print("[G-Studio] Updated on disk: ", tscn_path)


func on_scene_opened(scene_root: Node) -> void:
	if scene_root == null:
		return
	_try_apply_pending(scene_root)


# --- Reverse sync: Godot scene -> .gs ---

func on_scene_saving() -> void:
	if _skip_next_save_back:
		_skip_next_save_back = false
		return

	var edited = EditorInterface.get_edited_scene_root()
	if edited == null:
		return

	var scene_path = edited.scene_file_path
	if scene_path.is_empty():
		return

	var gs_path = scene_path.replace(".tscn", ".gs")
	if not FileAccess.file_exists(gs_path):
		return

	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return

	var recognized: Dictionary = handler.recognize(edited)
	if recognized.is_empty():
		return

	var existing_regions: Array = gs_data.get("data", {}).get("regions", [])
	var new_regions = _assign_ids(recognized.get("regions", []), existing_regions)

	gs_data["data"]["regions"] = new_regions
	_write_gs(gs_path, gs_data)
	print("[G-Studio] Synced scene -> .gs: ", gs_path)


# --- Internal: forward sync helpers ---

func _try_apply_pending(scene_root: Node) -> void:
	var scene_path = scene_root.scene_file_path
	if scene_path.is_empty():
		return

	var gs_path = ""
	if _pending_syncs.has(scene_path):
		gs_path = _pending_syncs[scene_path]
		_pending_syncs.erase(scene_path)
	else:
		var candidate = scene_path.replace(".tscn", ".gs")
		if FileAccess.file_exists(candidate) and FileAccess.file_exists(scene_path):
			if FileAccess.get_modified_time(candidate) > FileAccess.get_modified_time(scene_path):
				gs_path = candidate

	if gs_path.is_empty():
		return

	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return

	_last_known_versions[gs_path] = gs_data.get("version", 0)
	_ensure_groups_for_gs(gs_data)

	var data: Dictionary = gs_data.get("data", {})
	var regions: Array = data.get("regions", [])
	var texture_path = _resolve_texture(gs_path, data.get("texture", ""))

	handler.apply(regions, scene_root, texture_path)
	_skip_next_save_back = true
	EditorInterface.save_scene()
	print("[G-Studio] Applied pending + saved: ", scene_path)


func _create_tscn_from_gs(gs_path: String) -> bool:
	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return false

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return false

	_last_known_versions[gs_path] = gs_data.get("version", 0)
	_ensure_groups_for_gs(gs_data)
	handler.create_scene(gs_data, gs_path)
	return true


func _update_tscn_from_gs(gs_path: String, tscn_path: String) -> bool:
	var gs_data = _read_gs(gs_path)
	if gs_data.is_empty():
		return false

	var gs_type = int(gs_data.get("type", 0))
	var handler = _handlers.get(gs_type)
	if handler == null:
		return false

	_last_known_versions[gs_path] = gs_data.get("version", 0)
	_ensure_groups_for_gs(gs_data)

	var packed = ResourceLoader.load(tscn_path, "", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		return false

	var instance = packed.instantiate()
	var data: Dictionary = gs_data.get("data", {})
	var regions: Array = data.get("regions", [])
	var texture_path = _resolve_texture(gs_path, data.get("texture", ""))

	handler.apply(regions, instance, texture_path)

	var new_packed = PackedScene.new()
	new_packed.pack(instance)
	ResourceSaver.save(new_packed, tscn_path)
	instance.free()
	return true


# --- Notify editor about file changes (replaces scan()) ---

func _notify_file_changed(path: String) -> void:
	EditorInterface.get_resource_filesystem().update_file(path)


# --- Dynamic global groups ---

func _ensure_groups_for_gs(gs_data: Dictionary) -> void:
	var regions: Array = gs_data.get("data", {}).get("regions", [])
	for region in regions:
		var groups: Array = region.get("groups", [])
		for g in groups:
			var gs = str(g)
			if not gs.is_empty():
				_ensure_global_group(gs)


func _ensure_global_group(group_name: String) -> void:
	var key = "global_group/" + group_name
	if not ProjectSettings.has_setting(key):
		ProjectSettings.set_setting(key, "G-Studio: " + group_name)
		ProjectSettings.save()


# --- ID assignment ---

func _assign_ids(recognized: Array, existing: Array) -> Array:
	var by_name: Dictionary = {}
	for r in existing:
		by_name[r.get("name", "")] = r

	var max_id: int = 0
	for r in existing:
		var id_str = str(r.get("id", "r0"))
		var num = id_str.replace("r", "").to_int()
		if num > max_id:
			max_id = num

	for region in recognized:
		var rname = str(region.get("name", ""))
		if by_name.has(rname):
			region["id"] = by_name[rname].get("id", "r0")
		else:
			max_id += 1
			region["id"] = "r%d" % max_id

	return recognized


func _resolve_texture(gs_path: String, relative: Variant) -> String:
	if relative == null or (relative is String and str(relative).is_empty()):
		return ""
	var gs_dir = gs_path.get_base_dir()
	return gs_dir.path_join(str(relative)).simplify_path()


func _is_path_in_list(path: String, list: PackedStringArray) -> bool:
	for item in list:
		if item == path:
			return true
	return false


# --- File I/O ---

func _read_gs(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var text = f.get_as_text()
	f.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		push_error("[G-Studio] Failed to parse: %s" % path)
		return {}
	if json.data is Dictionary:
		return json.data
	return {}


func _write_gs(path: String, data: Dictionary) -> bool:
	var current = _read_gs(path)
	var disk_version: int = 0
	if not current.is_empty():
		disk_version = int(current.get("version", 0))

	var expected: int = 0
	if _last_known_versions.has(path):
		expected = int(_last_known_versions[path])
	if disk_version > expected:
		push_warning("[G-Studio] Write conflict on %s: disk=%d expected=%d" % [path, disk_version, expected])
		return false

	data["version"] = disk_version + 1
	data["gen"] = "godot-plugin/0.1.0"

	var json_text = JSON.stringify(data, "  ")
	var f = FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("[G-Studio] Cannot write: %s" % path)
		return false
	f.store_string(json_text)
	f.close()

	_last_known_versions[path] = data["version"]
	_mark_self_written(path)
	return true


func _mark_self_written(path: String) -> void:
	_self_written[path] = Time.get_unix_time_from_system()


func _is_self_written(path: String) -> bool:
	if not _self_written.has(path):
		return false
	var written_at = float(_self_written[path])
	var now = Time.get_unix_time_from_system()
	_self_written.erase(path)
	return (now - written_at) < 2.0
