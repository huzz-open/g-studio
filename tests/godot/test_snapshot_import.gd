extends SceneTree
func _initialize() -> void:
	var folder := ProjectSettings.globalize_path("res://../output/gs-snapshot-import")
	DirAccess.make_dir_recursive_absolute(folder)
	for id in DirAccess.get_directories_at("res://assets/gstudio"):
		if not FileAccess.file_exists("res://assets/gstudio/"+id+"/render_mesh.tres"):continue
		var mesh: Mesh = load("res://assets/gstudio/"+id+"/render_mesh.tres").get_mesh()
		var file := FileAccess.open(folder.path_join(id+".bin"),FileAccess.WRITE)
		# Read the renderer's vertex/index arrays directly, not TriangleMesh extraction.
		var arrays := mesh.surface_get_arrays(0)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var triangles := PackedVector3Array()
		for index in indices:triangles.append(vertices[index])
		file.store_buffer(triangles.to_byte_array())
		file.close()
	print("Imported Godot triangle positions dumped")
	quit()
