@tool
extends Node

signal gs_file_changed(path: String)

var _tracked: Dictionary = {}
var _timer: float = 0.0
const POLL_INTERVAL: float = 2.0


func _ready() -> void:
	_walk_all(_tracked)


func _process(delta: float) -> void:
	_timer += delta
	if _timer < POLL_INTERVAL:
		return
	_timer = 0.0
	_poll()


func _poll() -> void:
	var current: Dictionary = {}
	_walk_all(current)

	for path: String in current:
		var mtime: int = current[path]
		if not _tracked.has(path) or _tracked[path] != mtime:
			_tracked[path] = mtime
			gs_file_changed.emit(path)

	for path: String in _tracked.keys():
		if not current.has(path):
			_tracked.erase(path)


func _walk_all(out: Dictionary) -> void:
	_walk_dir("res://", out)


func _walk_dir(dir_path: String, out: Dictionary) -> void:
	var dir := DirAccess.open(dir_path)
	if not dir:
		return
	dir.list_dir_begin()
	var fname := dir.get_next()
	while fname != "":
		if dir.current_is_dir():
			if not fname.begins_with(".") and fname != "addons":
				_walk_dir(dir_path.path_join(fname), out)
		elif fname.ends_with(".gs"):
			var full := dir_path.path_join(fname)
			out[full] = FileAccess.get_modified_time(full)
		fname = dir.get_next()
	dir.list_dir_end()


func get_tracked_paths() -> Array[String]:
	var result: Array[String] = []
	for key: String in _tracked:
		result.append(key)
	return result
