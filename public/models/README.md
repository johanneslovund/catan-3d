# 3D Models

Drop Meshy.ai exports (GLB format) here. The game auto-detects them and uses them instead of the built-in procedural meshes. Missing files fall back gracefully.

## Expected filenames

| File | Used for |
|---|---|
| `settlement.glb` | Player settlements |
| `city.glb` | Player cities |
| `road.glb` | Player roads |
| `robber.glb` | The robber piece |

## Tips for Meshy.ai

- Export as **GLB** (binary GLTF)
- Use **low-poly / stylized** style — matches the Catan board game aesthetic
- Generate **without color** or with a neutral grey — the game tints each model to the player's color automatically (red, blue, orange, green)
- Suggested prompts:
  - `settlement.glb` → "Low poly medieval wooden house with triangular roof, game piece style, no texture, grey"
  - `city.glb` → "Low poly medieval castle with tower and smaller building, game piece style, no texture, grey"
  - `road.glb` → "Low poly straight wooden road segment, flat, game piece style"  
  - `robber.glb` → "Low poly hooded bandit figure, board game piece, no texture, dark"
- Scale doesn't matter — the game auto-scales models to fit the board
