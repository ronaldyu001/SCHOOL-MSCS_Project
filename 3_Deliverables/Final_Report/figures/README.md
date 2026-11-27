# Figures for Final_Report.tex

## Architecture diagrams — done

`component.png` and `module.png` are 2x Excalidraw exports of
`1_Planning/Architecture/{Component,Module}/*.excalidraw`, verified against
their sources by bounding-box aspect ratio. Both exports use scale 2.0 with a
20 px border.

The full diagrams are too dense to be legible at page size (smallest labels
land near 3 pt), so the report uses **cropped panels** instead. The full images
are kept here as the source for re-cropping.

| Panel in report   | Crop from       | Region (diagram units)        |
|-------------------|-----------------|-------------------------------|
| `component-a.png` | `component.png` | x 50..1275, y 105..1245       |
| `component-b.png` | `component.png` | x 1290..2930, y 105..1245     |
| `module-a.png`    | `module.png`    | x 318..2460, y 70..858        |
| `module-b.png`    | `module.png`    | x 318..2460, y 858..2115      |
| `module-c.png`    | `module.png`    | x 318..2460, y 2105..2440     |

Pixel mapping is `px = (unit - origin) * 2 + 20`, with origin (60,30) for the
component diagram and (20,20) for the module diagram.

### Re-cropping after a diagram edit

Re-export at 2x, overwrite `component.png` / `module.png`, then regenerate:

```sh
cd 3_Deliverables/Final_Report/figures
sips -c 2280 2450 --cropOffset 170 1    component.png --out component-a.png
sips -c 2280 3280 --cropOffset 170 2480 component.png --out component-b.png
sips -c 1576 4284 --cropOffset 120  616 module.png    --out module-a.png
sips -c 2514 4284 --cropOffset 1696 616 module.png    --out module-b.png
sips -c 650  4284 --cropOffset 4190 616 module.png    --out module-c.png
```

`sips` silently ignores a `--cropOffset` of 0, which is why the first crop uses
offset 1. Re-check the crop boundaries if the diagram layout changes, since the
offsets above are tied to the current element coordinates.

Resulting label sizes in the report: about 5.8 pt for the component panels and
4.2 pt for the module panels, against 3.9 pt and 2.5 pt for the uncropped
diagrams. The module panels drop the diagram's left-hand notes column (scope,
legend, research boundaries); that content is carried in the figure captions
and in Sections 3.2, 3.3 and 3.5 instead.

## Still needed — result plots

| File to create      | Data source                                                  |
|---------------------|--------------------------------------------------------------|
| `budget-curves.pdf` | `budget-curves.csv`, rows with category `all`                |
| `by-category.pdf`   | `budget-curves.csv`, rows with `budget` = 512, by `category` |

Both come from an evaluation run's published artifacts (`summary.json`,
`per-question.jsonl`, `budget-curves.csv`). To place one, delete the whole
`\phfig{...}{...}{...}{...}` call in the .tex and put this in its place:

```latex
\includegraphics[width=\linewidth]{figures/budget-curves.pdf}
```
