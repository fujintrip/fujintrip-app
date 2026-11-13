// Ground-transport know-how block (ground-transport plan, Nov 12,
// 2026): renders one or two know-how entries — title, how-to lines,
// honesty footer — under a transport row or leg card. When a leg has
// no string in the plan file (domestic-flight intercity legs), it
// falls back to the plan file's general rule, never an invented line.
import { GENERAL_KNOW_HOW_FOOTER, type TransportKnowHow } from '../lib/groundTransport';

export default function KnowHowBlock({
  entries,
}: {
  entries: Array<TransportKnowHow | null | undefined>;
}) {
  const list = entries.filter((e): e is TransportKnowHow => !!e);
  if (list.length === 0) {
    return (
      <p className="plan-note">
        How to book — guidance, not a booking yet. {GENERAL_KNOW_HOW_FOOTER}
      </p>
    );
  }
  return (
    <>
      {list.map((k) => (
        <div key={k.key}>
          <p className="plan-line">
            <b>{k.title}:</b>
          </p>
          <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 14 }}>
            {k.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <p className="plan-note">{k.notIncluded}</p>
        </div>
      ))}
    </>
  );
}
