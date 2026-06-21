import bpy
bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/Users/JohannesLovund/Documents/Claude Code/catan/public/models/Stone tower_uncompressed.glb")
print("=== Scene objects ===")
for o in bpy.data.objects:
    print(f"  OBJ: {repr(o.name)}  type={o.type}  data={type(o.data).__name__}")
print("Done")
