"""
Blender headless script — adds a baked inverted-hull outline mesh to GLB files.
Run from the catan/ directory with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python add_outline.py
"""
import bpy
import bmesh
import os

THICKNESS = 0.045   # world-unit normal expansion

FILES = [
    ("public/models/Stone tower_uncompressed.glb",  "public/models/Stone tower_outlined.glb"),
    ("public/models/Castle_uncompressed.glb",        "public/models/Castle_outlined.glb"),
]

def process(in_file, out_file):
    base    = os.path.dirname(os.path.abspath(__file__))
    abs_in  = os.path.join(base, in_file)
    abs_out = os.path.join(base, out_file)
    print(f"\n=== {abs_in} → {abs_out} ===")

    # 1. Fresh scene, import
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=abs_in)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        print("  No mesh objects — skipping.")
        return
    print(f"  Found {len(meshes)} mesh object(s)")

    # 2. Select all, apply transforms
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 3. Join into one mesh if multiple
    if len(meshes) > 1:
        bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = "_source"

    # 4. Duplicate for outline
    bpy.ops.object.select_all(action='DESELECT')
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    bpy.ops.object.duplicate()
    outline_obj = bpy.context.active_object
    outline_obj.name = "_outline"

    # 5. Expand vertices along normals using bmesh
    mesh_data = outline_obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh_data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * THICKNESS
    bm.to_mesh(mesh_data)
    bm.free()
    mesh_data.update()

    # 6. White emissive material named "_outline"
    mat = bpy.data.materials.new(name="_outline")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out_node = nodes.new("ShaderNodeOutputMaterial")
    em_node  = nodes.new("ShaderNodeEmission")
    em_node.inputs["Color"].default_value    = (1.0, 1.0, 1.0, 1.0)
    em_node.inputs["Strength"].default_value = 2.0
    links.new(em_node.outputs["Emission"], out_node.inputs["Surface"])
    outline_obj.data.materials.clear()
    outline_obj.data.materials.append(mat)

    # 7. Export
    bpy.ops.export_scene.gltf(
        filepath=abs_out,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
    )
    print(f"  Saved → {abs_out}")

for in_f, out_f in FILES:
    process(in_f, out_f)

print("\nAll done.")
