import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  Minus,
  Download,
  Printer,
  Focus,
  ChevronDown,
} from "lucide-react";
import { renderTreePng } from "./graph-export";
import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import {
  type Person,
  type Relation,
  type ViewMode,
  ancestry,
  partnership,
  nameOf,
  visiblePeople,
} from "./domain";
import { Avatar, Busy } from "./ui";
type PersonNode = Node<
  {
    person: Person;
    selected: boolean;
    matched: boolean;
    collapsed: boolean;
    onSelect: (p: Person) => void;
    onAdd: (p: Person) => void;
    onCollapse: (id: string) => void;
  },
  "person"
>;
const PersonCard = memo(({ data }: NodeProps<PersonNode>) => (
  <div
    className={`person-node ${data.selected ? "selected" : ""} ${data.matched ? "matched" : ""}`}
  >
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <Handle type="source" position={Position.Right} id="partner" />
    <Handle type="target" position={Position.Left} id="partner-target" />
    <button
      className="person-main nodrag"
      aria-label={`View ${nameOf(data.person)}`}
      onClick={() => data.onSelect(data.person)}
    >
      <Avatar person={data.person} />
      <span>
        <strong>{nameOf(data.person)}</strong>
        <small>
          {data.person.birthDate
            ? `${data.person.birthApprox ? "c. " : ""}${data.person.birthDate.slice(0, 4)}`
            : "Birth unknown"}
          {data.person.status === "deceased"
            ? ` — ${data.person.deathDate.slice(0, 4) || "?"}`
            : ""}
        </small>
      </span>
    </button>
    <div className="node-footer">
      <span>
        {data.person.status === "living" ? (
          <>
            <i />
            Living
          </>
        ) : data.person.status === "deceased" ? (
          "In memory"
        ) : (
          "Details to discover"
        )}
      </span>
      <button
        className="nodrag"
        aria-label={`Add relative to ${nameOf(data.person)}`}
        title="Add relative"
        onClick={() => data.onAdd(data.person)}
      >
        <Plus size={12} />
      </button>
      <button
        className="nodrag"
        aria-label={`${data.collapsed ? "Expand" : "Collapse"} branch of ${nameOf(data.person)}`}
        title={data.collapsed ? "Expand branch" : "Collapse branch"}
        onClick={() => data.onCollapse(data.person.id)}
      >
        {data.collapsed ? <Plus size={12} /> : <Minus size={12} />}
      </button>
    </div>
  </div>
));
const nodeTypes = { person: PersonCard };
function GraphInner({
  people,
  relations,
  selected,
  focus,
  setFocus,
  onSelect,
  onAdd,
  search,
  treeName,
}: {
  people: Person[];
  relations: Relation[];
  selected: string;
  focus: string;
  setFocus: (id: string) => void;
  onSelect: (p: Person) => void;
  onAdd: (p: Person) => void;
  search: string;
  treeName: string;
}) {
  const [mode, setMode] = useState<ViewMode>("extended"),
    [depth, setDepth] = useState(6),
    [collapsed, setCollapsed] = useState(new Set<string>()),
    [positions, setPositions] = useState(
      new Map<string, { x: number; y: number }>(),
    ),
    [layoutBusy, setLayoutBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const effectiveFocus = focus || people[0]?.id;
  const shown = useMemo(() => {
    if (focus || mode !== "extended")
      return visiblePeople(effectiveFocus, relations, mode, depth, collapsed);
    const all = new Set(people.map((p) => p.id));
    if (!collapsed.size) return all;
    const roots = people.filter(
      (p) => !relations.some((r) => ancestry(r) && r.toId === p.id),
    );
    const visible = new Set<string>();
    for (const p of roots)
      for (const id of visiblePeople(
        p.id,
        relations,
        "descendants",
        10000,
        collapsed,
      ))
        visible.add(id);
    return visible;
  }, [people, relations, focus, effectiveFocus, mode, depth, collapsed]);
  const layoutKey = JSON.stringify({
    ids: [...shown].sort(),
    edges: relations
      .filter(
        (r) => !partnership(r) && shown.has(r.fromId) && shown.has(r.toId),
      )
      .map((r) => [r.id, r.fromId, r.toId]),
  });
  useEffect(() => {
    setLayoutBusy(true);
    setError("");
    const input = JSON.parse(layoutKey);
    const elk = new ELK({
      workerUrl: elkWorkerUrl,
      workerFactory: (url) => new Worker(url!),
    });
    let active = true;
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      elk.terminateWorker();
      setLayoutBusy(false);
      setError("Layout took too long. Select a person and fewer generations.");
    }, 30000);
    elk
      .layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.spacing.nodeNode": "35",
          "elk.layered.spacing.nodeNodeBetweenLayers": "75",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        },
        children: input.ids.map((id: string) => ({
          id,
          width: 196,
          height: 102,
        })),
        edges: input.edges.map(([id, from, to]: string[]) => ({
          id,
          sources: [from],
          targets: [to],
        })),
      })
      .then((graph) => {
        if (!active) return;
        setPositions(
          new Map(
            (graph.children || []).map((p) => [
              p.id,
              { x: p.x || 0, y: p.y || 0 },
            ]),
          ),
        );
        fitTimer = setTimeout(
          () => flow.fitView({ padding: 0.18, duration: 350, maxZoom: 1 }),
          80,
        );
        setLayoutBusy(false);
        clearTimeout(timer);
        elk.terminateWorker();
      })
      .catch(() => {
        if (active) {
          setLayoutBusy(false);
          setError("Layout failed. Try fewer generations.");
          clearTimeout(timer);
          elk.terminateWorker();
        }
      });
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(fitTimer);
      elk.terminateWorker();
    };
  }, [layoutKey]);
  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const nodes: PersonNode[] = people
    .filter((p) => shown.has(p.id))
    .map((p, i) => ({
      id: p.id,
      type: "person",
      position: positions.get(p.id) || {
        x: (i % 4) * 240,
        y: Math.floor(i / 4) * 170,
      },
      data: {
        person: p,
        selected: p.id === selected,
        matched:
          !!search &&
          nameOf(p).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        collapsed: collapsed.has(p.id),
        onSelect,
        onAdd,
        onCollapse: toggle,
      },
    }));
  const edges: Edge[] = relations
    .filter((r) => shown.has(r.fromId) && shown.has(r.toId))
    .map((r) => ({
      id: r.id,
      source:
        partnership(r) &&
        (positions.get(r.fromId)?.x || 0) > (positions.get(r.toId)?.x || 0)
          ? r.toId
          : r.fromId,
      target:
        partnership(r) &&
        (positions.get(r.fromId)?.x || 0) > (positions.get(r.toId)?.x || 0)
          ? r.fromId
          : r.toId,
      type: partnership(r) ? "default" : "smoothstep",
      sourceHandle: partnership(r) ? "partner" : undefined,
      targetHandle: partnership(r) ? "partner-target" : undefined,
      label: partnership(r) ? r.endReason || "♡" : undefined,
      style: {
        stroke: partnership(r)
          ? "#bb8b7c"
          : r.kind === "adoptive"
            ? "#628c9b"
            : r.kind === "guardian" || r.kind === "step"
              ? "#b28e4a"
              : "#8a9e91",
        strokeWidth: 1.5,
        strokeDasharray:
          r.kind === "biological" || r.kind === "parent" ? undefined : "5 4",
      },
      labelStyle: { fill: "#886353", fontSize: 12 },
      labelBgStyle: { fill: "#fafbf7" },
      ariaLabel: `${r.kind} relationship`,
    }));
  async function exportImage(print = false) {
    const printWindow = print ? window.open("", "_blank") : null;
    setExporting(true);
    setError("");
    try {
      if (layoutBusy) throw new Error("Wait for the tree to finish arranging.");
      const data = await renderTreePng(
        treeName,
        nodes.map((n) => n.data.person),
        relations,
        positions,
      );
      if (print) {
        const w = printWindow;
        if (!w) throw new Error("Allow pop-ups to open the print view.");
        w.document.title = `${treeName} · family tree`;
        const h = w.document.createElement("h1");
        h.textContent = treeName;
        const p = w.document.createElement("p");
        p.textContent = `${new Date().toLocaleDateString()} · ${nodes.length} people shown · Solid: parentage; dashed blue: adoption; dashed rose: partnership; gold: care. Diagram export is not a data backup.`;
        const img = w.document.createElement("img");
        img.style.width = "100%";
        img.src = data;
        w.document.body.append(h, p, img);
        img.onload = () => {
          w.focus();
          w.print();
        };
      } else {
        const a = document.createElement("a");
        a.href = data;
        a.download = `${treeName.replace(/[^a-z0-9]/gi, "-")}-tree.png`;
        a.click();
      }
    } catch (e) {
      printWindow?.close();
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="graph-card">
      <div className="graph-toolbar">
        <div className="segmented" aria-label="Tree view">
          {(["extended", "ancestors", "descendants"] as const).map((v) => (
            <button
              key={v}
              className={mode === v ? "active" : ""}
              onClick={() => {
                setMode(v);
                setCollapsed(new Set());
              }}
            >
              {v === "extended"
                ? "Extended family"
                : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="depth-select">
            <span className="sr-only">Generations or relationship steps</span>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[2, 3, 4, 6, 10, 20].map((n) => (
                <option value={n} key={n}>
                  {n} {mode === "extended" ? "steps" : "generations"}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <button
            className="icon-button"
            title="Export visible tree as PNG"
            aria-label="Export tree image"
            disabled={exporting}
            onClick={() => exportImage()}
          >
            <Download size={17} />
          </button>
          <button
            className="icon-button"
            title="Print or save as PDF"
            aria-label="Print tree or save PDF"
            disabled={exporting}
            onClick={() => exportImage(true)}
          >
            <Printer size={17} />
          </button>
        </div>
      </div>
      <div className="graph-focus">
        <label>
          <Focus size={14} />
          <select
            aria-label="Focus person"
            value={focus}
            onChange={(e) => {
              setFocus(e.target.value);
              setCollapsed(new Set());
            }}
          >
            <option value="">
              {mode === "extended"
                ? "Whole family"
                : `Start with ${people[0]?.givenName || "first person"}`}
            </option>
            {people.map((p) => (
              <option value={p.id} key={p.id}>
                {nameOf(p)}
              </option>
            ))}
          </select>
        </label>
        <span>
          {nodes.length} of {people.length} people
          {collapsed.size > 0 && (
            <button
              className="text-button"
              onClick={() => setCollapsed(new Set())}
            >
              Expand all
            </button>
          )}
        </span>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="graph-canvas" ref={viewport}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          minZoom={0.15}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={22} size={1} color="#dfe5dc" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor="#cbd9c9"
            maskColor="rgba(247,248,242,.65)"
            pannable
            zoomable
          />
        </ReactFlow>
        {(layoutBusy || exporting) && (
          <div className="graph-loading">
            <Busy
              label={exporting ? "Preparing export…" : "Arranging your family…"}
            />
          </div>
        )}
      </div>
      <div className="graph-footer">
        <span>
          <i className="legend-line" />
          Parentage
        </span>
        <span>
          <i className="legend-line adoptive" />
          Adoption
        </span>
        <span>
          <i className="legend-line partnership" />
          Partnership
        </span>
        <span>
          <i className="legend-line care" />
          Care
        </span>
        <p>Scroll to zoom · Drag to explore</p>
      </div>
    </div>
  );
}
export function FamilyGraph(props: Parameters<typeof GraphInner>[0]) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
