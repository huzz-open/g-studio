@tool
extends EditorPlugin
func _enter_tree() -> void:
	add_tool_menu_item("G-Studio assets",_open_assets)
func _exit_tree() -> void:
	remove_tool_menu_item("G-Studio assets")
func _open_assets() -> void:
	EditorInterface.get_file_system_dock().navigate_to_path("res://assets/gstudio/")
