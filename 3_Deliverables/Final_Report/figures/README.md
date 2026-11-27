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
| `component-a.png` | `component.png` | x 50..1242, y 105..1245       |
| `component-b.png` | `component.png` | x 1242..2500, y 105..1245     |
| `component-c.png` | `component.png` | x 2500..2930, y 105..1245     |
| `module-a.png`    | `module.png`    | x 318..2460, y 70..858        |
| `module-b.png`    | `module.png`    | x 318..2460, y 858..2115      |
| `module-c.png`    | `module.png`    | x 318..2460, y 2105..2440     |

Pixel mapping is `px = (unit - origin) * 2 + 20`, with origin (60,30) for the
component diagram and (20,20) for the module diagram.

### Page orientation

Every page of the report is upright letter portrait; nothing sets `/Rotate`.
The component panels are placed upright, so they read without turning the
page. The module panels are placed with `rotating`'s `sidewaysfigure`, which
rotates the figure and its caption on an otherwise normal portrait page --
unlike `pdflscape`, which rotates the page itself.

The module panels have to be sideways because the diagram cannot be cut
vertically. Eight of its labels span the full 2030-unit width of a band
(the composition, presentation, application, and infrastructure summaries, the
HTTP transport note, and the domain entity list), so any vertical cut would
slice running text mid-sentence. Re-flowing the diagram into a narrow layout
would not help either: the gain from halving its width is cancelled by the
portrait text block being 6 in wide where the rotated one is 9 in tall, which
lands at the same label size. Making the module panels upright and larger
means redrawing the diagram as a single narrow column.

### Panel cut lines

Component cuts fall in the two vertical gaps in the diagram, so no box or
label is divided:

* `x = 1242` sits between the application-services group (ends at 1240) and
  the research-workflows group (starts at 1320). It is placed left of 1245 so
  the `dispatch` arrow label at x 1245..1335 stays whole. Two arrows and the
  backend container and its heading cross this cut; the captions say so.
* `x = 2500` sits between the backend boundary (ends at 2480) and the external
  services boundary (starts at 2520). Only the two backend-to-service arrows
  cross it.

All three component panels share the vertical crop `y 105..1245`, so they
reassemble into the original diagram. Panels a and b are placed at
`height=5.43in`; panel c is a narrow strip and is placed larger
(`height=7.1in`) so it does not get lost on the page.

The module panels drop the diagram's left-hand notes column (scope, legend,
research boundaries); that content is carried in the figure captions and in
Sections 3.2, 3.3 and 3.5 instead.

### Resulting label sizes

Measured on the most common label size in each diagram (17 units for the
component diagram, 14 for the module diagram):

| Figure in report | Placed at        | Label size |
|------------------|------------------|------------|
| 3.1, 3.2         | `height=5.43in`  | 5.8 pt     |
| 3.3              | `height=7.1in`   | 7.6 pt     |
| 3.6, 3.7, 3.8    | `width=8.8in`    | 4.1 pt     |

For comparison, the uncropped diagrams land at 3.9 pt (component) and 2.5 pt
(module) at the same placements.

### Re-cropping after a diagram edit

Re-export at 2x, overwrite `component.png` / `module.png`, then regenerate:

```sh
cd 3_Deliverables/Final_Report/figures
sips -c 2280 2384 --cropOffset 170 1    component.png --out component-a.png
sips -c 2280 2516 --cropOffset 170 2384 component.png --out component-b.png
sips -c 2280  860 --cropOffset 170 4900 component.png --out component-c.png
sips -c 1576 4284 --cropOffset 120  616 module.png    --out module-a.png
sips -c 2514 4284 --cropOffset 1696 616 module.png    --out module-b.png
sips -c 650  4284 --cropOffset 4190 616 module.png    --out module-c.png
```

`sips` silently ignores a `--cropOffset` of 0, which is why the first crop uses
offset 1. Re-check the crop boundaries if the diagram layout changes, since the
offsets above are tied to the current element coordinates.

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
