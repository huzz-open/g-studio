@tool
extends Node
## Watches for .gs file changes via mtime polling.
## New file detection uses EditorFileSystem signals instead of per-tick full walk.

signal gs_file_changed(path: String)

var _tracked_files: Dictionary = {}  # path → mtime
var _poll_timer: float = 0.0
var _scan_interval: float = 1.0


func _ready():
	_scan_project_for_gs_files()
	EditorInterface.get_resource_filesystem().filesystem_changed.connect(_on_filesystem_changed)


func _process(delta: float):
	_poll_timer += delta
	if _poll_timer < _scan_interval:
		return
	_poll_timer = 0.0
	_check_mtimes()


func _scan_project_for_gs_files():
	_tracked_files.clear()
	_scan_dir("res://")


func _scan_dir(path: String):
	var dir = DirAccess.open(path)
	if not dir:
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if dir.current_is_dir():
			if not file_name.begins_with(".") and file_name != "addons":
				_scan_dir(path.path_join(file_name))
		elif file_name.ends_with(".gs"):
			var full_path = path.path_join(file_name)
			_tracked_files[full_path] = FileAccess.get_modified_time(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()


func _check_mtimes():
	for path in _tracked_files.keys():
		if not FileAccess.file_exists(path):
			_tracked_files.erase(path)
			continue
		var mtime = FileAccess.get_modified_time(path)
		if mtime != _tracked_files[path]:
			_tracked_files[path] = mtime
			gs_file_changed.emit(path)


func _on_filesystem_changed():
	_find_new_gs_files("res://")


func _find_new_gs_files(path: String):
	var dir = DirAccess.open(path)
	if not dir:
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if dir.current_is_dir():
			if not file_name.begins_with(".") and file_name != "addons":
				_find_new_gs_files(path.path_join(file_name))
		elif file_name.ends_with(".gs"):
			var full_path = path.path_join(file_name)
			if not _tracked_files.has(full_path):
				_tracked_files[full_path] = FileAccess.get_modified_time(full_path)
				gs_file_changed.emit(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()


func rescan():
	_scan_project_for_gs_files()
