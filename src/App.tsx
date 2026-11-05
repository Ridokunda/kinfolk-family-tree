import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  GitBranch,
  Users,
  Archive,
  Settings as SettingsIcon,
  Plus,
  Search,
  ShieldCheck,
  ChevronRight,
  Link2,
  Leaf,
  WifiOff,
  Download,
  Check,
  X,
  Menu,
  ArrowUpRight,
  Heart,
  FolderPlus,
} from "lucide-react";
import { db, createTree, loadDemo } from "./db";
import {
  type Person,
  type Relation,
  type Tree,
  blankPerson,
  nameOf,
  friendlyError,
  ancestry,
} from "./domain";
import { PersonEditor, RelationshipEditor } from "./PersonEditor";
import { Profile } from "./Profile";
import { BackupCenter } from "./BackupCenter";
import { Settings } from "./Settings";
import { RestoreWelcome } from "./RestoreWelcome";
import { Avatar, Busy, Modal, EmptyState } from "./ui";
const FamilyGraph = lazy(() =>
  import("./FamilyGraph").then((m) => ({ default: m.FamilyGraph })),
);
type Page = "tree" | "people" | "backups" | "settings";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
function readSelected() {
  try {
    return localStorage.getItem("kinfolk-selected") || "";
  } catch {
    return "";
  }
}
export default function App() {
  const trees = useLiveQuery(() => db.trees.toArray());
  const [treeId, setTreeId] = useState(readSelected),
    [page, setPage] = useState<Page>("tree"),
    [selectedId, setSelectedId] = useState(""),
    [focus, setFocus] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [edit, setEdit] = useState<{ person: Person; relative?: Person } | null>(
      null,
    ),
    [relationship, setRelationship] = useState<Relation | true | null>(null),
    [newTree, setNewTree] = useState(false),
    [restoreWelcome, setRestoreWelcome] = useState(false),
    [cached, setCached] = useState(false),
    [newName, setNewName] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [working, setWorking] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [installEvent, setInstallEvent] = useState<InstallEvent | null>(null),
    [installHelp, setInstallHelp] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [outdated, setOutdated] = useState(false);
  const tree = trees?.find((t) => t.id === treeId) || trees?.[0];
  const people =
    useLiveQuery<Person[]>(
      () =>
        tree
          ? db.people.where("treeId").equals(tree.id).toArray()
          : Promise.resolve([]),
      [tree?.id],
    ) || [];
  const relations =
    useLiveQuery<Relation[]>(
      () =>
        tree
          ? db.relations.where("treeId").equals(tree.id).toArray()
          : Promise.resolve([]),
      [tree?.id],
    ) || [];
  const latestBackup = useLiveQuery(async () => {
    if (!tree) return undefined;
    return (
      await db.backups
        .where("treeId")
        .equals(tree.id)
        .filter((b) => b.outcome === "verified")
        .sortBy("verifiedAt")
    ).at(-1);
  }, [tree?.id]);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (e) =>
      setError(`Offline setup could not finish: ${e.message}`),
  });
  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setCached(true)).catch(() => {});
  }, []);
  const notify = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const off = () => setOnline(navigator.onLine),
      install = (e: Event) => {
        e.preventDefault();
        setInstallEvent(e as InstallEvent);
      },
      old = () => setOutdated(true);
    window.addEventListener("online", off);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("database-outdated", old);
    return () => {
      window.removeEventListener("online", off);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("database-outdated", old);
    };
  }, []);
  function selectTree(t: Tree) {
    setTreeId(t.id);
    try {
      localStorage.setItem("kinfolk-selected", t.id);
    } catch {}
    setSelectedId("");
    setFocus("");
    setSearch("");
    setEdit(null);
    setRelationship(null);
  }
  function navigate(p: Page) {
    setPage(p);
    setMobileNav(false);
    setSelectedId("");
  }
  async function demo() {
    setWorking(true);
    try {
      selectTree(await loadDemo());
      setPage("tree");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWorking(false);
    }
  }
  async function addTree() {
    setWorking(true);
    setError("");
    try {
      selectTree(await createTree(newName));
      setNewTree(false);
      setNewName("");
      setPage("tree");
      notify("Your family tree is ready");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWorking(false);
    }
  }
  async function install() {
    if (installEvent) {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
    } else setInstallHelp(true);
  }
  const selected = people.find((p) => p.id === selectedId);
  const matches = people.filter((p) =>
    nameOf(p).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const listed = matches
    .filter((p) => filter === "all" || p.status === filter)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const generations = useMemo(() => {
    if (!people.length) return 0;
    const levels = new Map(people.map((p) => [p.id, 1]));
    const links = relations.filter(ancestry);
    const degrees = new Map(people.map((p) => [p.id, 0]));
    const children = new Map<string, string[]>();
    for (const r of links) {
      degrees.set(r.toId, (degrees.get(r.toId) || 0) + 1);
      children.set(r.fromId, [...(children.get(r.fromId) || []), r.toId]);
    }
    const queue = [...degrees]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    for (let i = 0; i < queue.length; i++) {
      for (const child of children.get(queue[i]) || []) {
        levels.set(
          child,
          Math.max(levels.get(child) || 1, (levels.get(queue[i]) || 1) + 1),
        );
        degrees.set(child, degrees.get(child)! - 1);
        if (degrees.get(child) === 0) queue.push(child);
      }
    }
    return Math.max(...levels.values());
  }, [people, relations]);
  const overdue =
    !!tree &&
    (!latestBackup ||
      (tree.revision > latestBackup.revision &&
        Date.now() - Date.parse(latestBackup.createdAt) > 7 * 86400000));
  const closeEditor = useCallback(() => setEdit(null), []),
    closeRelation = useCallback(() => setRelationship(null), []),
    closeNew = useCallback(() => setNewTree(false), []);
  if (!trees)
    return (
      <div className="boot">
        <Leaf size={40} />
        <Busy label="Opening your family archive…" />
      </div>
    );
  return (
    <div className="app-shell">
      <button
        className="mobile-menu icon-button"
        aria-label="Toggle navigation"
        onClick={() => setMobileNav(!mobileNav)}
      >
        <Menu />
      </button>
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("tree");
          }}
        >
          <span className="brand-mark">
            <GitBranch size={23} />
          </span>
          <span>
            Generations<small>EVERY BRANCH HAS A STORY</small>
          </span>
        </a>
        <div className="tree-switcher">
          <label htmlFor="tree-select">YOUR FAMILY ARCHIVE</label>
          <select
            id="tree-select"
            value={tree?.id || ""}
            onChange={(e) => {
              const t = trees.find((t) => t.id === e.target.value);
              if (t) selectTree(t);
            }}
          >
            {!trees.length && <option value="">Your first family tree</option>}
            {trees.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="text-button" onClick={() => setNewTree(true)}>
            <Plus size={13} />
            New family tree
          </button>
        </div>
        <nav>
          {(
            [
              { id: "tree", label: "Family tree", icon: GitBranch },
              { id: "people", label: "People", icon: Users },
              { id: "backups", label: "Backups", icon: Archive },
              { id: "settings", label: "Settings", icon: SettingsIcon },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {item.id === "people" && <span>{people.length}</span>}
              {item.id === "backups" && overdue && <i className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="little-tree">
            <Leaf size={23} />
          </div>
          <h3>Stories worth keeping.</h3>
          <p>
            A name is a beginning.
            <br />A memory makes it a story.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span>
            <ShieldCheck size={16} />
            Private on this device
          </span>
          <small>Your family data stays with you.</small>
          <button className="text-button" onClick={install}>
            <Download size={14} />
            Install Generations
            <ArrowUpRight size={13} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            My archive
            <ChevronRight size={13} />
            <strong>
              {page === "tree"
                ? "Family tree"
                : page.charAt(0).toUpperCase() + page.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="connectivity">
              {!online ? (
                <>
                  <WifiOff size={14} />
                  Offline
                </>
              ) : offlineReady || cached ? (
                <>
                  <Check size={14} />
                  Offline ready
                </>
              ) : (
                <>
                  <ShieldCheck size={14} />
                  On this device
                </>
              )}
            </span>
            <span className="user-badge">
              <Leaf size={17} />
            </span>
          </div>
        </header>
        {outdated && (
          <div className="notice warning">
            A newer app version opened this database. Reload this tab before
            editing. <button onClick={() => location.reload()}>Reload</button>
          </div>
        )}
        {needRefresh && (
          <div className="notice">
            An app update is ready. Finish editing, then reload.
            <button
              className="text-button"
              disabled={!!edit || !!relationship}
              onClick={() => updateServiceWorker(true)}
            >
              Update app
            </button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="workspace">
          {!tree ? (
            <div className="welcome">
              <span className="eyebrow">
                YOUR FAMILY. YOUR HISTORY. YOURS TO KEEP.
              </span>
              <h1>
                Every branch,
                <br />
                <em>a story.</em>
              </h1>
              <p>
                Bring your family’s connections and memories together.
                <br />A private little archive, ready to grow with you.
              </p>
              <div className="welcome-actions">
                <button className="button" onClick={() => setNewTree(true)}>
                  <Plus size={18} />
                  Start your family tree
                </button>
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={demo}
                >
                  {working ? <Busy /> : "Explore a sample tree"}
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                className="text-button"
                style={{ marginTop: 16 }}
                onClick={() => setRestoreWelcome(true)}
              >
                <Archive size={14} />
                Restore a backup
              </button>
              <div className="welcome-tree" aria-hidden="true">
                <svg viewBox="0 0 600 240">
                  <path
                    d="M300 68v45M150 113h300M150 113v60M450 113v60M300 113v60"
                    fill="none"
                    stroke="#a8bba6"
                    strokeWidth="2"
                  />
                  <circle cx="300" cy="45" r="38" fill="#dae5d0" />
                  <circle cx="150" cy="190" r="30" fill="#f0dfd2" />
                  <circle cx="300" cy="190" r="30" fill="#e4e8cd" />
                  <circle cx="450" cy="190" r="30" fill="#dce5e6" />
                </svg>
                <Leaf className="welcome-leaf" size={32} />
              </div>
              <div className="welcome-promises">
                <span>
                  <ShieldCheck size={18} />
                  Private on your device
                </span>
                <span>
                  <WifiOff size={18} />
                  Works offline
                </span>
                <span>
                  <Archive size={18} />
                  Portable USB backups
                </span>
              </div>
              <p className="welcome-warning small">
                Browser storage is a working copy, not a backup. Keep an
                external copy of your family records.
              </p>
            </div>
          ) : page === "backups" ? (
            <BackupCenter
              key={tree.id}
              tree={tree}
              onRestored={selectTree}
              notify={notify}
            />
          ) : page === "settings" ? (
            <Settings
              key={tree.id}
              tree={tree}
              install={install}
              onBackup={() => navigate("backups")}
              notify={notify}
            />
          ) : (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow">
                    {tree.isDemo
                      ? "FICTIONAL SAMPLE · MAKE YOURSELF AT HOME"
                      : "CONNECTED BY FAMILY. KEPT THROUGH STORIES."}
                  </span>
                  <h1>
                    {page === "people"
                      ? "The people in your story."
                      : tree.name}
                  </h1>
                  <p>
                    {page === "people"
                      ? "Names, faces, and the lives that connect us."
                      : tree.description ||
                        "Explore your roots. Discover your connections. Keep their stories close."}
                  </p>
                </div>
                <div className="intro-actions">
                  {people.length >= 2 && (
                    <button
                      className="button secondary"
                      onClick={() => setRelationship(true)}
                    >
                      <Link2 size={16} />
                      Connect people
                    </button>
                  )}
                  <button
                    className="button"
                    onClick={() => setEdit({ person: blankPerson(tree.id) })}
                  >
                    <Plus size={17} />
                    Add person
                  </button>
                </div>
              </div>
              <div className="family-summary">
                <span>
                  <Users size={17} />
                  <strong>{people.length}</strong>family members
                </span>
                <span>
                  <GitBranch size={17} />
                  <strong>{generations}</strong>generations
                </span>
                <span>
                  <Heart size={17} />
                  <strong>
                    {
                      relations.filter(
                        (r) => r.kind === "marriage" || r.kind === "partner",
                      ).length
                    }
                  </strong>
                  partnerships
                </span>
                <div className="summary-right">
                  {tree.isDemo ? (
                    <span className="badge">Sample data</span>
                  ) : (
                    <span>
                      <Check size={14} />
                      Saved on this device
                    </span>
                  )}
                </div>
              </div>
              <div className="workspace-toolbar">
                <div className="search-wrap">
                  <Search size={17} />
                  <input
                    aria-label="Search family members"
                    placeholder="Find someone in your family…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                  {search && page === "tree" && (
                    <div className="search-results">
                      {matches.length ? (
                        matches.slice(0, 10).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setSelectedId(p.id);
                              setFocus(p.id);
                            }}
                          >
                            <Avatar person={p} size="small" />
                            <span>
                              {nameOf(p)}
                              <small>{p.birthDate || "Date unknown"}</small>
                            </span>
                          </button>
                        ))
                      ) : (
                        <p>No matching family members</p>
                      )}
                    </div>
                  )}
                </div>
                {page === "people" ? (
                  <select
                    aria-label="Filter living status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Everyone</option>
                    <option value="living">Living</option>
                    <option value="deceased">Deceased</option>
                    <option value="unknown">Status unknown</option>
                  </select>
                ) : (
                  <span className="toolbar-tip">
                    Click a person to discover their story
                  </span>
                )}
              </div>
              <div className={`content-split ${selected ? "has-profile" : ""}`}>
                <div className="content-primary">
                  {!people.length ? (
                    <EmptyState
                      icon={<GitBranch size={36} />}
                      title="Your family story starts here"
                    >
                      <p>
                        Add the first person. You can connect parents, children,
                        partners, and other relatives as you go.
                      </p>
                      <button
                        className="button"
                        onClick={() =>
                          setEdit({ person: blankPerson(tree.id) })
                        }
                      >
                        <Plus size={16} />
                        Add your first person
                      </button>
                    </EmptyState>
                  ) : page === "tree" ? (
                    <Suspense
                      fallback={
                        <div className="panel">
                          <Busy label="Opening your tree…" />
                        </div>
                      }
                    >
                      <FamilyGraph
                        key={tree.id}
                        treeName={tree.name}
                        people={people}
                        relations={relations}
                        selected={selectedId}
                        focus={focus}
                        setFocus={setFocus}
                        onSelect={(p) => setSelectedId(p.id)}
                        onAdd={(p) =>
                          setEdit({ person: blankPerson(tree.id), relative: p })
                        }
                        search={search}
                      />
                    </Suspense>
                  ) : (
                    <div className="people-grid">
                      {listed.map((p) => (
                        <button
                          className={`person-tile ${p.id === selectedId ? "selected" : ""}`}
                          key={p.id}
                          onClick={() => setSelectedId(p.id)}
                        >
                          <Avatar person={p} size="large" />
                          <strong>{nameOf(p)}</strong>
                          <span>
                            {p.birthDate
                              ? `Born ${p.birthApprox ? "around " : ""}${p.birthDate}`
                              : "Birth not recorded"}
                          </span>
                          <span className={`status ${p.status}`}>
                            {p.status === "unknown"
                              ? "Status unknown"
                              : p.status}
                          </span>
                          <span className="tile-link">
                            View their story
                            <ChevronRight size={14} />
                          </span>
                        </button>
                      ))}
                      {!listed.length && (
                        <p className="muted">
                          No family members match this search.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {selected && (
                  <Profile
                    key={selected.id}
                    person={selected}
                    people={people}
                    relations={relations}
                    onClose={() => setSelectedId("")}
                    onEdit={() => setEdit({ person: selected })}
                    onRelative={() =>
                      setEdit({
                        person: blankPerson(tree.id),
                        relative: selected,
                      })
                    }
                    onSelect={(p) => setSelectedId(p.id)}
                    onFocus={() => {
                      setPage("tree");
                      setFocus(selected.id);
                    }}
                    onEditRelation={setRelationship}
                    notify={notify}
                  />
                )}
              </div>
              {overdue && people.length > 0 && (
                <div className="backup-reminder">
                  <span className="reminder-icon">
                    <Archive size={21} />
                  </span>
                  <div>
                    <strong>Give your family story a second home.</strong>
                    <p>
                      {latestBackup
                        ? "Your backup is over a week old and newer changes exist."
                        : "There is no verified backup for this tree yet."}{" "}
                      Save a copy to a USB drive and check it.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("backups")}
                  >
                    Back up your tree
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              )}
              <div className="workspace-foot">
                <Leaf size={13} />
                Small details. Lasting connections.
                <span>Generations · Your private family archive</span>
              </div>
            </>
          )}
        </div>
      </main>
      {edit && (
        <PersonEditor
          person={edit.person}
          relative={edit.relative}
          people={people}
          onClose={closeEditor}
          onSaved={(p) => {
            setEdit(null);
            setSelectedId(p.id);
            setFocus(p.id);
            notify("Family member saved on this device");
          }}
        />
      )}
      {relationship && tree && (
        <RelationshipEditor
          treeId={tree.id}
          people={people}
          initial={relationship === true ? undefined : relationship}
          onClose={closeRelation}
          onSaved={() => {
            setRelationship(null);
            notify("Relationship saved");
          }}
        />
      )}
      {restoreWelcome && (
        <RestoreWelcome
          onClose={() => setRestoreWelcome(false)}
          onRestored={(t) => {
            selectTree(t);
            setRestoreWelcome(false);
            setPage("tree");
            notify("Family tree restored on this device");
          }}
        />
      )}
      {newTree && (
        <Modal title="Start a family tree" onClose={closeNew}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              addTree();
            }}
          >
            <p className="muted">
              Choose a name for your family archive. You can rename it later.
            </p>
            <label>
              Family tree name
              <input
                autoFocus
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. The Netshisahulu family"
                maxLength={120}
              />
            </label>
            <div className="notice small">
              <ShieldCheck size={17} />
              Records stay in this browser. Back up regularly to keep an
              independent copy.
            </div>
            <div className="modal-actions">
              <button
                className="button secondary"
                type="button"
                onClick={closeNew}
              >
                Cancel
              </button>
              <button className="button" disabled={working || !newName.trim()}>
                {working ? (
                  <Busy />
                ) : (
                  <>
                    <FolderPlus size={16} />
                    Create family tree
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {installHelp && (
        <Modal
          title="Install Generations"
          onClose={() => setInstallHelp(false)}
        >
          <div className="form">
            <p>
              In Chrome or Edge, look for the install icon in the address bar or
              “Install app” in the browser menu. On iPhone or iPad, open in
              Safari, choose Share, then Add to Home Screen.
            </p>
            <p>
              Wait for “Offline ready” before disconnecting. If installation is
              unavailable, bookmark the site and continue using it in this
              browser.
            </p>
            <p className="notice warning">
              Installing the app does not create an independent backup of your
              family records.
            </p>
            <button className="button" onClick={() => setInstallHelp(false)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
