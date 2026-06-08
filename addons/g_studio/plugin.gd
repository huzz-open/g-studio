@tool
extends EditorPlugin

var _watcher
var _manager

var _global_groups = {
	"occlude_top_layer": "G-Studio: Top layer",
	"occlude_y_sort": "G-Studio: Y-sort",
	"occlude_screen_mask": "G-Studio: Screen mask",
	"occlude_opacity_50": "G-Studio: Opacity 50%",
}


func _enter_tree():
	_watcher = preload("gs_file_watcher.gd").new()
	_manager = preload("gs_scene_manager.gd").new()
	add_child(_watcher)
	add_child(_manager)
	_watcher.gs_file_changed.connect(_manager.on_gs_changed)
	_ensure_global_groups()
	call_deferred("_initial_sync")
	print("[G-Studio] Plugin enabled")


func _exit_tree():
	if _watcher:
		_watcher.queue_free()
	if _manager:
		_manager.queue_free()
	print("[G-Studio] Plugin disabled")


func _save_external_data():
	if _manager:
		_manager.on_scene_saving()


func _initial_sync():
	if _watcher and _manager:
		_manager.initial_sync(_watcher.get_tracked_paths())


func _ensure_global_groups():
	var changed = false
	for group_name in _global_groups:
		var key = "global_group/" + group_name
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, _global_groups[group_name])
			changed = true
	if changed:
		ProjectSettings.save()
		print("[G-Studio] Registered global groups")
