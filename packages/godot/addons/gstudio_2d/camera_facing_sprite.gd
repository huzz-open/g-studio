@tool
extends Sprite3D
@export var anchor_offset := Vector2.ZERO
@export var pixels_per_unit := 100.0
@export var bottom_pixel := -1.0
var visible_bounds := Rect2()
func _ready() -> void:
	process_priority=10
	alpha_scissor_threshold=0.08
	if texture:
		visible_bounds=Rect2(Vector2.ZERO,texture.get_size())
		if bottom_pixel>=0.0:visible_bounds.size.y=bottom_pixel
	_sync_camera()
static func visible_pixel_bounds(pixels:Image,threshold:float=0.08) -> Rect2:
	if pixels.is_compressed():pixels.decompress()
	var mask:=BitMap.new()
	mask.create_from_image_alpha(pixels,threshold)
	var minimum:=Vector2i(pixels.get_width(),pixels.get_height())
	var maximum:=Vector2i(-1,-1)
	for y in range(pixels.get_height()):
		for x in range(pixels.get_width()):
			if mask.get_bit(x,y):
				minimum=minimum.min(Vector2i(x,y))
				maximum=maximum.max(Vector2i(x,y))
	return Rect2(Vector2(minimum),Vector2(maximum-minimum+Vector2i.ONE)) if maximum.x>=0 else Rect2()
func _process(_delta:float) -> void:
	_sync_camera()
func _sync_camera() -> void:
	var camera:=get_viewport().get_camera_3d()
	# In the editor, author against the scene camera rather than the inspection camera.
	if Engine.is_editor_hint() and get_tree().edited_scene_root:
		var cameras:=get_tree().edited_scene_root.find_children("*","Camera3D",true,false)
		if not cameras.is_empty():
			camera=cameras[0] as Camera3D
			for candidate in cameras:
				if candidate.current:camera=candidate;break
	var anchor:=get_parent() as Node3D
	if camera==null or anchor==null or texture==null:return
	# Static assets arrive cropped by GS. Only animation viewport textures
	# need a per-frame region; their canvas size stays fixed across frames.
	if texture and visible_bounds.has_area():
		region_enabled=texture is ViewportTexture
		if region_rect!=visible_bounds:region_rect=visible_bounds
	var axes:=camera.global_transform.basis.orthonormalized()
	var instance_scale:=anchor.global_transform.basis.get_scale()
	var crop_center:=visible_bounds.get_center() if visible_bounds.has_area() else texture.get_size()*0.5
	var display_offset:=anchor_offset+crop_center-texture.get_size()*0.5
	var center:=anchor.global_position+(axes.x*display_offset.x*instance_scale.x-axes.y*display_offset.y*instance_scale.y)/pixels_per_unit
	# A camera-facing card may cross the floor at its lower pixels. Move only
	# the display card along the viewing ray: projection is unchanged, physics is untouched.
	if texture and visible_bounds.has_area() and axes.z.y>0.001 and camera.projection==Camera3D.PROJECTION_ORTHOGONAL:
		var minimum_y:=INF
		for x in [visible_bounds.position.x,visible_bounds.end.x]:
			for y in [visible_bounds.position.y,visible_bounds.end.y]:
				var corner:Vector3=center+axes.x*(x-crop_center.x)*instance_scale.x/pixels_per_unit-axes.y*(y-crop_center.y)*instance_scale.y/pixels_per_unit
				minimum_y=minf(minimum_y,corner.y)
		center+=axes.z*((anchor.global_position.y+0.001-minimum_y)/axes.z.y)
	global_transform=Transform3D(axes.scaled(instance_scale),center)
