import { useState, type FormEvent } from "react";
import {
  type Person,
  type Relation,
  duplicatePeople,
  friendlyError,
  kindLabel,
  kinds,
  nameOf,
  now,
  uid,
} from "./domain";
import { savePerson, saveRelation } from "./db";
import { Modal, Busy } from "./ui";
const parentKinds: Relation["kind"][] = ["biological", "adoptive", "parent"];
export function PersonEditor({
  person,
  people,
  relative,
  onClose,
  onSaved,
}: {
  person: Person;
  people: Person[];
  relative?: Person;
  onClose: () => void;
  onSaved: (p: Person) => void;
}) {
  const [form, setForm] = useState(person),
    [kind, setKind] = useState<Relation["kind"]>("biological"),
    [direction, setDirection] = useState("child"),
    [otherParentId, setOtherParentId] = useState(""),
    [otherParentKind, setOtherParentKind] =
      useState<Relation["kind"]>("biological"),
    [allowDuplicate, setAllowDuplicate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const existing = people.some((p) => p.id === person.id),
    duplicates = duplicatePeople(form, people);
  const addingChild =
    !!relative && direction === "child" && parentKinds.includes(kind);
  const availableParents = people
    .filter(
      (p) =>
        p.treeId === person.treeId &&
        p.id !== relative?.id &&
        p.id !== person.id,
    )
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const change = (key: keyof Person, value: unknown) =>
    setForm((p) => ({ ...p, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (duplicates.length && !allowDuplicate) {
      setError("Confirm that this is a different person with a similar name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const relation: Relation | undefined = relative
        ? {
            id: uid(),
            treeId: person.treeId,
            fromId: direction === "parent" ? person.id : relative.id,
            toId: direction === "parent" ? relative.id : person.id,
            kind,
            startDate: "",
            endDate: "",
            endReason: "",
            notes: "",
            createdAt: now(),
          }
        : undefined;
      const newRelations = relation ? [relation] : [];
      if (addingChild && otherParentId) {
        if (!availableParents.some((p) => p.id === otherParentId))
          throw new Error(
            "The other parent is no longer available. Choose another family member or leave it unknown.",
          );
        newRelations.push({
          ...relation!,
          id: uid(),
          fromId: otherParentId,
          toId: person.id,
          kind: otherParentKind,
        });
      }
      const p = await savePerson(form, newRelations);
      onSaved(p);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        existing
          ? "Edit family member"
          : relative
            ? `Add a relative of ${relative.givenName || "this person"}`
            : "Add a family member"
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="form">
        <p className="muted">
          Every detail is optional. Add what you know; the story can grow over
          time.
        </p>
        <div className="form-grid">
          <label>
            Given names
            <input
              autoFocus
              value={form.givenName}
              onChange={(e) => change("givenName", e.target.value)}
              maxLength={160}
              placeholder="e.g. Evelyn"
            />
          </label>
          <label>
            Surname
            <input
              value={form.surname}
              onChange={(e) => change("surname", e.target.value)}
              maxLength={160}
              placeholder="Family name"
            />
          </label>
          <label>
            Gender
            <select
              value={form.gender}
              onChange={(e) => change("gender", e.target.value)}
            >
              <option value="unknown">Not recorded</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="nonbinary">Nonbinary</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Living status
            <select
              value={form.status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="unknown">Unknown</option>
              <option value="living">Living</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>
          <div className="date-field">
            <label>
              Birth date
              <input
                value={form.birthDate}
                onChange={(e) => change("birthDate", e.target.value)}
                placeholder="YYYY, YYYY-MM, or YYYY-MM-DD"
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.birthApprox}
                onChange={(e) => change("birthApprox", e.target.checked)}
              />
              Approximate birth date
            </label>
          </div>
          <div className="date-field">
            <label>
              Death date
              <input
                value={form.deathDate}
                onChange={(e) => change("deathDate", e.target.value)}
                placeholder="Leave blank if unknown"
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.deathApprox}
                onChange={(e) => change("deathApprox", e.target.checked)}
              />
              Approximate death date
            </label>
          </div>
        </div>
        <label>
          Birthplace
          <input
            value={form.birthplace}
            onChange={(e) => change("birthplace", e.target.value)}
            placeholder="Town, province, country"
            maxLength={300}
          />
        </label>
        <label>
          Biography
          <textarea
            rows={3}
            value={form.biography}
            onChange={(e) => change("biography", e.target.value)}
            placeholder="The people, places, and moments that shaped their life."
            maxLength={20000}
          />
        </label>
        <label>
          Private notes
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => change("notes", e.target.value)}
            placeholder="Memories, sources, or details to confirm."
            maxLength={20000}
          />
        </label>
        {relative && (
          <fieldset>
            <legend>Connect to {nameOf(relative)}</legend>
            <div className="form-grid">
              <label>
                Relationship type
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Relation["kind"])}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel[k]}
                    </option>
                  ))}
                </select>
              </label>
              {!["marriage", "partner"].includes(kind) && (
                <label>
                  Direction
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                  >
                    <option value="child">
                      New person is the child / person in care
                    </option>
                    <option value="parent">
                      New person is the parent / caregiver
                    </option>
                  </select>
                </label>
              )}
            </div>
            {addingChild && (
              <div className="form-grid" style={{ marginTop: 16 }}>
                <label>
                  Other parent (optional)
                  <select
                    value={otherParentId}
                    onChange={(e) => setOtherParentId(e.target.value)}
                  >
                    <option value="">Unknown / add later</option>
                    {availableParents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {nameOf(p)}
                        {p.birthDate ? ` · ${p.birthDate}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {otherParentId && (
                  <label>
                    Other parent’s relationship
                    <select
                      value={otherParentKind}
                      onChange={(e) =>
                        setOtherParentKind(e.target.value as Relation["kind"])
                      }
                    >
                      {parentKinds.map((k) => (
                        <option key={k} value={k}>
                          {kindLabel[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p
                  className="small muted"
                  style={{ gridColumn: "1 / -1", marginBottom: 0 }}
                >
                  {nameOf(relative)} will be linked as a parent. Select the
                  other parent if known.
                </p>
              </div>
            )}
          </fieldset>
        )}
        {duplicates.length > 0 && (
          <div className="notice warning">
            A similar person exists: {duplicates.map(nameOf).join(", ")}.
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allowDuplicate}
                onChange={(e) => setAllowDuplicate(e.target.checked)}
              />
              This is a different person.
            </label>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <span className="muted small">Saved privately on this device</span>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? <Busy /> : existing ? "Save changes" : "Add family member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RelationshipEditor({
  people,
  treeId,
  initial,
  onClose,
  onSaved,
}: {
  people: Person[];
  treeId: string;
  initial?: Relation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Relation>(
      initial || {
        id: uid(),
        treeId,
        fromId: people[0]?.id || "",
        toId: people[1]?.id || "",
        kind: "biological",
        startDate: "",
        endDate: "",
        endReason: "",
        notes: "",
        createdAt: now(),
      },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (key: keyof Relation, value: string) =>
    setForm((r) => ({ ...r, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveRelation(form);
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const options = people.map((p) => (
    <option key={p.id} value={p.id}>
      {nameOf(p)}
      {p.birthDate ? ` · ${p.birthDate}` : ""}
    </option>
  ));
  return (
    <Modal
      title={initial ? "Edit relationship" : "Connect family members"}
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        <p className="muted">
          Parent and caregiver links run from the first person to the second.
          Partnerships connect both people equally.
        </p>
        <label>
          Relationship type
          <select
            value={form.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          First person · parent / caregiver / partner
          <select
            value={form.fromId}
            onChange={(e) => change("fromId", e.target.value)}
          >
            {options}
          </select>
        </label>
        <label>
          Second person · child / person in care / partner
          <select
            value={form.toId}
            onChange={(e) => change("toId", e.target.value)}
          >
            {options}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Start date
            <input
              value={form.startDate}
              onChange={(e) => change("startDate", e.target.value)}
              placeholder="YYYY, YYYY-MM, YYYY-MM-DD"
            />
          </label>
          <label>
            End date
            <input
              value={form.endDate}
              onChange={(e) => change("endDate", e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <label>
          End reason
          <select
            value={form.endReason}
            onChange={(e) => change("endReason", e.target.value)}
          >
            <option value="">Ongoing or unknown</option>
            <option value="divorce">Divorce</option>
            <option value="separation">Separation</option>
            <option value="death">Death</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Notes
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => change("notes", e.target.value)}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy || people.length < 2}>
            {busy ? <Busy /> : "Save relationship"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
