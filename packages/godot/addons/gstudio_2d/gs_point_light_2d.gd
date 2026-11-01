@tool
class_name GSPointLight2D
extends Marker2D
@export var enabled := true
@export var color := Color.WHITE
@export var shadow_enabled := true
@export var offset := Vector2.ZERO
var energy := 2.0
const WORLD = preload("res://addons/gstudio_2d/gs_world_2d.gd")
@export_range(0.0,20.0,0.05) var height_world := 1.4
@export_range(0.1,100.0,0.1) var range_world := 6.0
@export_range(0.0,32.0,0.05) var base_energy := 2.0
@export var flicker_enabled := false
@export var flicker_amount := 0.08
@export var flicker_speed := 8.0
var clock := 0.0
func _ready() -> void:
	if Engine.is_editor_hint():return
	add_to_group("gs_lights")
	WORLD.ensure(get_viewport())
func _process(delta: float) -> void:
	clock += delta
	energy = base_energy*(1.0+flicker_amount*sin(clock*flicker_speed)) if flicker_enabled else base_energy
