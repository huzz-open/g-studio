@tool
extends Node

signal gs_file_changed(path: String)

var _tracked = {}
var _timer = 0.0
var _interval = 2.0


func _ready():
	_walk_all(_tracked)


func _process(delta):
	_timer += delta
	if _timer < _interval:
		return
	_timer = 0.0
	_poll()


func _poll():
	var current = {}
	_walk_all(current)

	for path in current:
		var mtime = current[path]
		if not _tracked.has(path) or _tracked[path] != mtime:
			_tracked[path] = mtime
			gs_file_changed.emit(path)

	for path in _tracked.keys():
		if not current.has(path):
			_tracked.erase(path)


func _walk_all(out):
	_walk_dir("res://", out)


func _walk_dir(dir_path, out):
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


func get_tracked_paths():
	return _tracked.keys()
