@tool
extends EditorPlugin

var _watcher: Node
var _manager: Node


func _enter_tree():
	_watcher = preload("gs_file_watcher.gd").new()
	_manager = preload("gs_scene_manager.gd").new()
	add_child(_watcher)
	add_child(_manager)
	_watcher.gs_file_changed.connect(_manager.on_gs_changed)
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


func _enable_plugin():
	_check_export_filter()


func _check_export_filter():
	var presets_path = "res://export_presets.cfg"
	if FileAccess.file_exists(presets_path):
		var content = FileAccess.get_file_as_string(presets_path)
		if "*.gs" not in content:
			push_warning("[G-Studio] 建议在导出预设的 exclude_filter 中添加: *.gs")
	else:
		push_warning("[G-Studio] 建议在导出预设中配置排除 filter: *.gs")
