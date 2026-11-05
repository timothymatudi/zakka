import type { ReactNode } from 'react';

export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="num w-full min-w-[36rem] text-sm">
        <thead className="bg-sand text-start text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
