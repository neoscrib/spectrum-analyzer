import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Download, Upload, Radio } from "lucide-react";
import { ArmerInformation } from "./ArmerInformation";
import { ArmerNowPlaying } from "./ArmerNowPlaying";
import { useArmerReception } from "../armer/reception";
import {
  mergeAliases,
  resolver,
  ruleKey,
  validId,
  type ArmerConfig,
  type ArmerFeed,
  type P25Event,
  type SeenTalkgroup,
  type TalkgroupRule,
} from "../armer/model";
import {
  exportSdrtrunk,
  parseSdrtrunk,
  type ImportedPlaylist,
} from "../armer/xml";

interface Props {
  config: ArmerConfig;
  onChange: Dispatch<SetStateAction<ArmerConfig>>;
  feed: ArmerFeed;
  generation: number;
  test: boolean;
  active: boolean;
  playing: boolean;
  control: number;
  onTune: (hz: number) => void;
}
const mhz = (hz: number) => (hz ? (hz / 1e6).toFixed(5) : "—");
function loadSeen(): SeenTalkgroup[] {
  try {
    const data = JSON.parse(
      localStorage.getItem("spectrum-armer-seen-v1") ?? "[]",
    );
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              validId(r.id) &&
              Number.isFinite(r.count) &&
              Number.isFinite(r.lastSeen) &&
              Number.isFinite(r.frequency),
          )
          .slice(-2000)
      : [];
  } catch {
    return [];
  }
}
export function ArmerPanel({
  config,
  onChange,
  feed,
  generation,
  test,
  active,
  playing,
  control,
  onTune,
}: Props) {
  const configRef = useRef(config);
  configRef.current = config;
  const [seen, setSeen] = useState<SeenTalkgroup[]>(loadSeen);
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const [history, setHistory] = useState<P25Event[]>([]);
  const [network, setNetwork] = useState({
    system: 0,
    wacn: 0,
    nac: 0,
    rfss: 0,
    site: 0,
  });
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [newId, setNewId] = useState(""),
    [newName, setNewName] = useState("");
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [imported, setImported] = useState<ImportedPlaylist | null>(null),
    [siteIndex, setSiteIndex] = useState(0);
  const [apiConfigured, setApiConfigured] = useState(false),
    [lookupBusy, setLookupBusy] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  useEffect(() => {
    setSeen(test ? [] : loadSeen());
    setHistory([]);
    setNetwork({ system: 0, wacn: 0, nac: 0, rfss: 0, site: 0 });
  }, [generation, test]);
  useEffect(() => {
    if (!feed.events.length) return;
    const relevant = feed.events.filter((e) => e.talkgroup > 0);
    setSeen((previous) => {
      const map = new Map(previous.map((r) => [r.id, r]));
      for (const e of relevant) {
        const old = map.get(e.talkgroup);
        map.set(e.talkgroup, {
          id: e.talkgroup,
          count: (old?.count ?? 0) + (e.kind === "grant" ? 1 : 0),
          lastSeen: Date.now(),
          frequency: e.frequency || old?.frequency || 0,
          source: e.source || old?.source || 0,
          encrypted: e.encrypted,
          message: e.message,
        });
      }
      return [...map.values()]
        .sort((a, b) => a.lastSeen - b.lastSeen)
        .slice(-2000);
    });
    setHistory((old) =>
      [
        ...relevant
          .filter((e) => e.kind === "grant" || e.kind === "voice")
          .reverse(),
        ...old,
      ].slice(0, 60),
    );
    setNetwork((old) => {
      const n = { ...old };
      for (const e of feed.events)
        for (const key of ["system", "wacn", "nac", "rfss", "site"] as const)
          if (e[key]) n[key] = e[key];
      return n;
    });
  }, [feed]);
  useEffect(() => {
    if (test) return;
    const timer = setInterval(() => {
      try {
        localStorage.setItem(
          "spectrum-armer-seen-v1",
          JSON.stringify(seenRef.current),
        );
      } catch {
        /* Storage optional. */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [test]);
  useEffect(() => {
    void fetch("/api/armer/aliases")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setApiConfigured(d?.configured === true))
      .catch(() => {});
  }, []);
  const resolve = useMemo(() => resolver(config), [config]);
  const seenById = useMemo(() => new Map(seen.map((r) => [r.id, r])), [seen]);
  const rows = useMemo(() => {
    const map = new Map(config.rules.map((r) => [ruleKey(r), r]));
    for (const s of seen)
      if (!map.has(`${s.id}:${s.id}`)) {
        const r = resolve(s.id);
        map.set(`${s.id}:${s.id}`, {
          id: s.id,
          name: r?.name ?? "",
          group: r?.group ?? "",
          listen: r?.listen,
          origin: r?.origin ?? "manual",
        });
      }
    return [...map.values()]
      .filter((r) =>
        `${r.id} ${r.max ?? ""} ${r.name} ${r.group}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((a, b) => a.id - b.id || (a.max ?? a.id) - (b.max ?? b.id));
  }, [config.rules, seen, resolve, query]);
  useEffect(
    () =>
      setPage((p) => Math.min(p, Math.max(0, Math.ceil(rows.length / 30) - 1))),
    [rows.length],
  );
  const update = (r: TalkgroupRule, patch: Partial<TalkgroupRule>) =>
    onChange((c) => {
      const index = c.rules.findIndex((item) => ruleKey(item) === ruleKey(r));
      const rule = { ...r, ...patch };
      return {
        ...c,
        rules:
          index < 0
            ? [...c.rules, rule]
            : c.rules.map((item, i) => (i === index ? rule : item)),
      };
    });
  const add = () => {
    const id = Number(newId);
    if (!validId(id)) {
      setError("Enter a talkgroup ID from 1 to 65535.");
      return;
    }
    try {
      const rules = mergeAliases(config.rules, [
        { id, name: newName.trim(), group: "", origin: "manual" },
      ]);
      onChange((c) => ({ ...c, rules }));
      setQuery(String(id));
      setPage(0);
      setNewId("");
      setNewName("");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const exportXml = () => {
    try {
      const blob = new Blob(
        [
          exportSdrtrunk(
            config,
            control,
            seen.map((s) => s.id),
          ),
        ],
        { type: "application/xml" },
      );
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "spectrum-armer.xml";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "Exported SDRTrunk playlist with aliases, listen settings, and control frequencies.",
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const importSite = () => {
    const site = imported?.sites[siteIndex];
    if (!site?.supported) return;
    try {
      const rules = mergeAliases(
        config.rules,
        imported!.lists[site.aliasList] ?? [],
      );
      onChange((c) => ({
        ...c,
        siteName: site.name,
        controls: site.frequencies,
        rules,
      }));
      onTune(site.frequencies[0]);
      setImported(null);
      setNotice(
        `Imported ${site.name}. Unlisted talkgroups keep your default listen setting.`,
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  async function lookup() {
    setLookupBusy(true);
    setError("");
    try {
      const response = await fetch("/api/armer/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "Alias lookup failed.");
      const rules = mergeAliases(configRef.current.rules, data.rules);
      onChange((c) => ({ ...c, rules }));
      setNotice(
        `Loaded ${data.rules.length} RadioReference aliases. Your custom names and listen choices were kept.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsername("");
      setPassword("");
      setLookupBusy(false);
    }
  }
  const status = feed.status;
  const fresh = useArmerReception(active, status);
  const audioTg = fresh ? status?.audioTalkgroup : 0;
  return (
    <section className="armer-panel" aria-label="ARMER decoder">
      <div className="armer-heading">
        <div>
          <div className="eyebrow">ARMER · P25 PHASE I</div>
          <h2>
            <Radio size={18} /> Talkgroups & calls
          </h2>
        </div>
        <span
          className={`chip ${fresh && status?.controlLocked ? "armer-lock" : ""}`}
          role="status"
        >
          {!active
            ? "Stopped"
            : !fresh
              ? "Waiting for receiver data"
              : status?.controlLocked
                ? "Control locked"
                : "Searching for control"}
        </span>
      </div>
      {test && (
        <div className="armer-test-note">
          GENERATED P25 IQ · Test IDs and vocoder data, not received radio
          traffic. Audio is a codec fixture, not speech.
        </div>
      )}
      <div className="armer-summary">
        <div>
          <span>System / WACN</span>
          <strong>
            {network.system ? network.system.toString(16).toUpperCase() : "—"} /{" "}
            {network.wacn ? network.wacn.toString(16).toUpperCase() : "—"}
          </strong>
        </div>
        <div>
          <span>RFSS / Site · NAC</span>
          <strong>
            {network.rfss || "—"} / {network.site || "—"} ·{" "}
            {network.nac ? network.nac.toString(16).toUpperCase() : "—"}
          </strong>
        </div>
        <div>
          <span>Control candidates · CRC valid / rejected</span>
          <strong data-testid="armer-valid">
            {status?.valid ?? 0} / {status?.invalid ?? 0}
          </strong>
          {status?.quality && (
            <small className="armer-quality" data-testid="armer-quality">
              {status.quality.validPerSecond.toFixed(1)} valid/s ·{" "}
              {status.quality.rejectedPercent === null
                ? "—"
                : status.quality.rejectedPercent.toFixed(1) + "%"}{" "}
              rejected · last {status.quality.seconds.toFixed(1)}s
            </small>
          )}
        </div>
      </div>
      <ArmerNowPlaying
        fresh={fresh}
        status={status}
        config={config}
        control={control}
        active={active}
        playing={playing}
      />
      <p className="caption">
        Rejections are CRC-failed decode candidates, not measured bit errors or
        total lost messages. Compare recent valid blocks/s when adjusting
        reception.
      </p>
      <p className="caption">
        One clear Phase I C4FM call at a time within the 2.4 MHz capture. Other
        grants stay visible. CQPSK/LSM simulcast and Phase II voice are not
        supported; encrypted audio is muted.
      </p>
      <ArmerInformation
        information={feed.status?.information}
        events={feed.events}
        generation={generation}
        test={test}
        active={active}
      />
      <div className="armer-tools">
        <label>
          Site name
          <input
            aria-label="ARMER site name"
            maxLength={160}
            value={config.siteName}
            onChange={(e) =>
              onChange((c) => ({ ...c, siteName: e.target.value }))
            }
          />
        </label>
        <button onClick={exportXml}>
          <Download size={14} /> Export SDRTrunk XML
        </button>
        <label className="armer-file">
          <Upload size={14} /> Import SDRTrunk XML
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            aria-label="Import SDRTrunk XML"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > 10 * 1024 * 1024)
                  throw Error("Use a playlist smaller than 10 MB.");
                const parsed = parseSdrtrunk(await file.text());
                if (!parsed.sites.some((s) => s.supported))
                  throw Error(
                    "No supported P25 Phase I C4FM tuner channels found.",
                  );
                setImported(parsed);
                setSiteIndex(parsed.sites.findIndex((s) => s.supported));
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </label>
      </div>
      {imported && (
        <div className="armer-import">
          <label>
            Playlist site
            <select
              aria-label="Playlist site"
              value={siteIndex}
              onChange={(e) => setSiteIndex(Number(e.target.value))}
            >
              {imported.sites.map((s, i) => (
                <option key={i} value={i} disabled={!s.supported}>
                  {s.name}
                  {!s.supported ? " · unsupported" : ""}
                </option>
              ))}
            </select>
          </label>
          <button onClick={importSite}>Use imported site & aliases</button>
          <button onClick={() => setImported(null)}>Cancel</button>
        </div>
      )}
      <div className="armer-policy">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.defaultListen}
            onChange={(e) =>
              onChange((c) => ({ ...c, defaultListen: e.target.checked }))
            }
          />{" "}
          Listen to unlisted talkgroups
        </label>
        <button
          onClick={() =>
            onChange((c) => ({
              ...c,
              defaultListen: true,
              rules: c.rules.map(({ listen, ...r }) => r),
            }))
          }
        >
          Listen all
        </button>
        <button
          onClick={() =>
            onChange((c) => ({
              ...c,
              defaultListen: false,
              rules: c.rules.map(({ listen, ...r }) => r),
            }))
          }
        >
          Mute all
        </button>
      </div>
      <div className="armer-search">
        <input
          aria-label="Search talkgroups"
          placeholder="Search ID, alias, or group…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <span>
          {rows.length} entries · {seen.length} observed{test ? " in test" : ""}
        </span>
      </div>
      <div className="armer-table-scroll">
        <table className="armer-table">
          <thead>
            <tr>
              <th>Listen</th>
              <th>Talkgroup</th>
              <th>Alias / group</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 30, page * 30 + 30).map((r) => {
              const s = r.max === undefined ? seenById.get(r.id) : undefined;
              const id =
                r.max === undefined ? String(r.id) : `${r.id}–${r.max}`;
              return (
                <tr
                  key={ruleKey(r)}
                  className={audioTg === r.id ? "armer-playing" : ""}
                >
                  <td>
                    <input
                      aria-label={`Listen to ${id}`}
                      type="checkbox"
                      checked={r.listen ?? config.defaultListen}
                      onChange={(e) => update(r, { listen: e.target.checked })}
                    />
                  </td>
                  <td className="armer-id">
                    {id}
                    <small>{s ? `${s.count} grants` : ""}</small>
                  </td>
                  <td>
                    <input
                      aria-label={`Alias for ${id}`}
                      placeholder={`Talkgroup ${id}`}
                      maxLength={240}
                      value={r.name}
                      onChange={(e) =>
                        update(r, { name: e.target.value, origin: "manual" })
                      }
                    />
                    <input
                      className="armer-group"
                      aria-label={`Group for ${id}`}
                      placeholder="Group"
                      maxLength={240}
                      value={r.group}
                      onChange={(e) =>
                        update(r, { group: e.target.value, origin: "manual" })
                      }
                    />
                    <small>
                      {r.origin === "local"
                        ? "Local reference alias"
                        : r.origin === "radioreference"
                          ? "RadioReference"
                          : r.origin === "import"
                            ? "Imported playlist"
                            : "Custom / observed"}
                    </small>
                  </td>
                  <td>
                    {s ? (
                      <>
                        <span>{mhz(s.frequency)} MHz</span>
                        <small>
                          {s.encrypted === true
                            ? "Encrypted"
                            : s.encrypted === null
                              ? "Encryption unknown"
                              : "Clear grant"}
                          {s.source ? ` · radio ${s.source}` : ""}
                        </small>
                        <small>{s.message}</small>
                      </>
                    ) : (
                      <span className="muted">Not observed</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="caption">
            No matching talkgroups. New IDs appear as control messages arrive.
          </p>
        )}
      </div>
      {rows.length > 30 && (
        <div className="armer-pagination">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} / {Math.ceil(rows.length / 30)}
          </span>
          <button
            disabled={(page + 1) * 30 >= rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      <form
        className="armer-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label="New talkgroup ID"
          placeholder="Talkgroup ID"
          type="number"
          min="1"
          max="65535"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          required
        />
        <input
          aria-label="New talkgroup alias"
          placeholder="Alias (optional)"
          maxLength={240}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">Add / update</button>
      </form>
      <details className="armer-directory">
        <summary>Alias directory · RadioReference</summary>
        <p className="caption">
          Optional lookup for ARMER system 3508. Requires a RadioReference
          Premium account and an approved application key on the local server.
          Aliases already work offline, and custom names and listen choices are
          preserved.
        </p>
        {apiConfigured ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void lookup();
            }}
          >
            <input
              aria-label="RadioReference username"
              autoComplete="off"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              aria-label="RadioReference password"
              autoComplete="off"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button disabled={lookupBusy}>
              {lookupBusy ? "Looking up…" : "Look up ARMER aliases"}
            </button>
          </form>
        ) : (
          <p className="caption">
            To enable lookup, set <code>RR_APP_KEY</code> in{" "}
            <code>.env.local</code> and restart the server. See{" "}
            <a
              href="https://support.radioreference.com/hc/en-us/articles/18844460198932-Database-Web-Service-API"
              target="_blank"
              rel="noreferrer"
            >
              RadioReference API requirements
            </a>
            .
          </p>
        )}
        <p className="caption">
          Lookup sends your login to RadioReference through this local server.
          Credentials are cleared after each request and are never saved in
          browser storage.
        </p>
      </details>
      {error && (
        <p className="armer-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="armer-notice" role="status">
          {notice}
        </p>
      )}
      <details className="armer-history">
        <summary>
          Recent calls · {history.length} events{!active ? " · stopped" : ""}
        </summary>
        <ol>
          {history.map((e, i) => (
            <li key={`${generation}:${e.time}:${i}`}>
              <strong>
                {e.talkgroup} · {resolve(e.talkgroup)?.name || "Unlisted"}
              </strong>
              <span>
                {mhz(e.frequency)} MHz · {e.kind}
                {e.encrypted === true
                  ? " · encrypted"
                  : e.encrypted === null
                    ? " · encryption unknown"
                    : " · clear"}
                {!(resolve(e.talkgroup)?.listen ?? config.defaultListen)
                  ? " · muted"
                  : ""}
              </span>
              {e.message && <small>{e.message}</small>}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
