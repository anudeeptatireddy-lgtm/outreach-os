// Domain/CSV input shared by "New campaign" and "Add companies": paste domains or upload a CSV
// (columns domain, first_name, last_name, email, title) with a parsed preview.
import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { Segmented } from "../../components/ui/Tabs";
import { Textarea } from "../../components/ui/Field";
import { cn } from "../../lib/cn";

export type CsvRow = { domain: string; first_name: string; last_name: string; email: string; title: string; ok: boolean };
export const CSV_COLUMNS = ["domain", "first_name", "last_name", "email", "title"] as const;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): { rows: CsvRow[]; error: string | null } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], error: "The file is empty." };
  const header = splitLine(lines[0]!).map((h) => h.toLowerCase());
  if (!header.includes("domain")) return { rows: [], error: 'The first row must be a header with a "domain" column.' };
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l);
    const get = (k: string) => cells[header.indexOf(k)] ?? "";
    const domain = get("domain");
    return { domain, first_name: get("first_name"), last_name: get("last_name"), email: get("email"), title: get("title"), ok: /\w\.\w/.test(domain) };
  });
  return { rows, error: null };
}

export function splitDomains(text: string): string[] {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

export type CompaniesValue = { mode: "paste" | "csv"; text: string; csv: string | null; fileName: string | null };
export const emptyCompanies: CompaniesValue = { mode: "paste", text: "", csv: null, fileName: null };

export function companiesPayload(v: CompaniesValue): { domains?: string[]; csv?: string } {
  return v.mode === "csv" ? (v.csv ? { csv: v.csv } : {}) : { domains: splitDomains(v.text) };
}
export function companiesCount(v: CompaniesValue): number {
  return v.mode === "csv" ? (v.csv ? parseCsv(v.csv).rows.filter((r) => r.ok).length : 0) : splitDomains(v.text).length;
}

export function CompaniesInput({ value, onChange, error }: { value: CompaniesValue; onChange: (v: CompaniesValue) => void; error?: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const parsed = value.csv ? parseCsv(value.csv) : null;
  const read = async (f: File) => onChange({ ...value, mode: "csv", csv: await f.text(), fileName: f.name });
  const n = companiesCount(value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">Companies</span>
        <Segmented
          label="How to add companies"
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          options={[{ value: "paste", label: "Paste domains" }, { value: "csv", label: "Upload CSV" }]}
        />
        <span className="num ml-auto font-mono text-xs text-muted">{n} {n === 1 ? "company" : "companies"}</span>
      </div>
      {value.mode === "paste" ? (
        <Textarea
          aria-label="Domains, one per line"
          aria-describedby="domains-help"
          rows={6}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder={"ledgerloop.io\npayrollpilot.com\nhttps://www.claimsbridge.ai"}
          className="font-mono text-[13px]"
          invalid={!!error}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void read(f);
            }}
            className={cn("flex flex-wrap items-center gap-3 rounded-card border border-dashed px-4 py-4", drag ? "border-accent bg-accent-soft/40" : "border-control")}
          >
            <FileUp className="h-5 w-5 text-faint" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              {value.fileName ? <span className="font-medium">{value.fileName}</span> : <span className="text-muted">Drop a CSV here, or choose a file.</span>}
              <p className="text-xs text-muted">Columns: domain (required), first_name, last_name, email, title. Rows with a contact skip the Hunter search.</p>
            </div>
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            <button type="button" onClick={() => file.current?.click()} className="h-8 rounded-control border border-control bg-surface px-3 text-sm font-medium hover:bg-raised">
              Choose file
            </button>
            {value.fileName && (
              <button type="button" aria-label="Remove file" onClick={() => onChange({ ...value, csv: null, fileName: null })} className="rounded p-1 text-faint hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {parsed?.error && <p className="text-xs text-negative">{parsed.error}</p>}
          {parsed && !parsed.error && (
            <div className="max-h-56 overflow-auto rounded-card border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-surface text-xs text-muted">
                  <tr>{CSV_COLUMNS.map((c) => <th key={c} className="px-3 py-2 font-normal">{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {parsed.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className={cn(!r.ok && "bg-negative-bg/50")}>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.domain || <span className="text-negative">missing</span>}</td>
                      <td className="px-3 py-1.5">{r.first_name || <span className="text-faint">—</span>}</td>
                      <td className="px-3 py-1.5">{r.last_name || <span className="text-faint">—</span>}</td>
                      <td className="px-3 py-1.5">{r.email || <span className="text-faint">—</span>}</td>
                      <td className="px-3 py-1.5">{r.title || <span className="text-faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 50 && <p className="px-3 py-2 text-xs text-muted">Showing 50 of {parsed.rows.length} rows.</p>}
            </div>
          )}
        </div>
      )}
      {error ? <p className="text-xs text-negative">{error}</p> : <p id="domains-help" className="text-xs text-muted">Any form works: acme.com, www.acme.com or a full URL. Duplicates and suppressed domains are skipped.</p>}
    </div>
  );
}
