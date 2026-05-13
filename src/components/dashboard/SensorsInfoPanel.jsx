import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/utils/cn';

// Reference panel surfaced from the BookType icon at the bottom of the
// right sidebar. Content is distilled from the
// `Professional_Information_Document.md` brief — kept here as JSX (not
// a runtime markdown parse) so we can highlight key roster figures and
// agency labels with the app's accent treatment.
//
// Each section carries a `searchable` blob (plain text) that the filter
// matches against — that way users can type partial words and still hit
// the right card without us having to walk JSX children at search time.

function Stat({ value, label }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded',
        'bg-[#16a085]/15 text-[#16a085] dark:bg-[#16a085]/20',
        'text-[11.5px] font-semibold tabular-nums leading-none',
      )}
    >
      <span>{value}</span>
      {label ? <span className="text-[10px] font-medium opacity-90">{label}</span> : null}
    </span>
  );
}

function K({ children }) {
  return (
    <strong className="font-semibold text-day-text dark:text-night-text">
      {children}
    </strong>
  );
}

function P({ children }) {
  return (
    <p className="text-[12px] leading-relaxed text-day-text/90 dark:text-night-text/90">
      {children}
    </p>
  );
}

function SubHead({ children }) {
  return (
    <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-[#16a085]">
      {children}
    </h4>
  );
}

function Bullet({ children }) {
  return (
    <li className="text-[12px] leading-relaxed text-day-text/90 dark:text-night-text/90 pl-3 relative">
      <span
        aria-hidden
        className="absolute left-0 top-[0.55em] h-1 w-1 rounded-full bg-[#16a085]"
      />
      {children}
    </li>
  );
}

// Equipment inventory row used inside the PMD inventory section. Padded
// generously on the left/right edges so the table reads cleanly at the
// sidebar's 360-px width; `leading-tight` lets longer names wrap to two
// lines instead of clipping.
function InventoryRow({ name, gb, kp, total }) {
  return (
    <tr className="border-b border-day-border/60 dark:border-night-border/60 last:border-b-0">
      <td className="py-1.5 px-2 text-[11.5px] leading-tight text-day-text dark:text-night-text">
        {name}
      </td>
      <td className="py-1.5 px-1 text-[11.5px] text-right tabular-nums text-day-muted dark:text-night-muted">
        {gb}
      </td>
      <td className="py-1.5 px-1 text-[11.5px] text-right tabular-nums text-day-muted dark:text-night-muted">
        {kp}
      </td>
      <td className="py-1.5 px-2 text-[11.5px] text-right tabular-nums font-semibold text-[#16a085]">
        {total}
      </td>
    </tr>
  );
}

const SECTIONS = [
  {
    id: 'overview',
    title: 'Overview',
    searchable:
      'overview purpose GLOF early warning hydrometeorological sensor networks Pakistan Gilgit-Baltistan Khyber Pakhtunkhwa monitoring valleys rainfall glacial lake river discharge community warning',
    body: (
      <>
        <P>
          The GLOF early warning and hydro-meteorological monitoring network in
          northern Pakistan supports observation of weather, rainfall, glacial
          lake levels, river stage, discharge, and community warning systems
          across vulnerable mountain valleys.
        </P>
        <P>
          Coverage spans <K>Gilgit-Baltistan</K> and{' '}
          <K>Khyber Pakhtunkhwa</K>, where rising temperatures, accelerated
          glacier melt, intense rainfall, and slope instability increase the
          risk of GLOFs, debris flows, flash floods, and downstream river
          surges.
        </P>
        <P>
          The network is composed of <K>three complementary systems</K> —
          PMD / GLOF-II for dedicated early warning, AKAH for community
          monitoring, and WAPDA GMRC for long-term basin-scale climate
          observation.
        </P>
      </>
    ),
  },
  {
    id: 'institutional',
    title: 'Institutional Context',
    searchable:
      'institutional context Hindu Kush Karakoram Himalayan glaciers GLOFs debris flows flash floods landslides PMD UNDP AKAH WAPDA GMRC community warning posts',
    body: (
      <>
        <P>
          Northern Pakistan contains a large concentration of glaciers and
          glacial lakes within the <K>Hindu Kush</K>, <K>Karakoram</K>, and{' '}
          <K>Himalayan</K> mountain systems. The sensor networks installed
          across GB and KP strengthen early warning by collecting field-based
          meteorological, hydrological, and lake-level observations.
        </P>
        <SubHead>Key institutional networks</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>
            <K>PMD &amp; UNDP-supported GLOF-II</K> — early warning and
            monitoring network for high-risk valleys.
          </Bullet>
          <Bullet>
            <K>Aga Khan Agency for Habitat (AKAH)</K> — community-based weather
            monitoring and early warning.
          </Bullet>
          <Bullet>
            <K>WAPDA Glacier Monitoring and Research Centre (GMRC)</K> —
            high-altitude automatic weather station network.
          </Bullet>
          <Bullet>
            Local community warning posts, village hazard watch groups, and
            district-level disaster management mechanisms.
          </Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'glof-ii-pmd',
    title: 'GLOF-II / PMD Network',
    searchable:
      'GLOF-II PMD project UNDP automatic weather station lake level gauge river level gauge discharge gauge rain gauge warning post 279 GB KP',
    body: (
      <>
        <P>
          The GLOF-II Project is designed to reduce the risk of Glacial Lake
          Outburst Floods and related climate-induced hazards in northern
          Pakistan. It expands earlier GLOF risk-reduction interventions across
          vulnerable valleys in <K>Gilgit-Baltistan</K> and{' '}
          <K>Khyber Pakhtunkhwa</K>.
        </P>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Stat value="279" label="total assets" />
          <Stat value="194" label="GB" />
          <Stat value="85" label="KP" />
        </div>
        <SubHead>Sensor asset inventory</SubHead>
        <div className="rounded-md border border-day-border dark:border-night-border overflow-hidden">
          <table className="w-full table-fixed">
            <colgroup>
              <col />
              <col className="w-9" />
              <col className="w-9" />
              <col className="w-12" />
            </colgroup>
            <thead className="bg-day-bg/60 dark:bg-night-bg/60">
              <tr className="text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted">
                <th className="py-1.5 px-2 text-left font-medium">Equipment</th>
                <th className="py-1.5 px-1 text-right font-medium">GB</th>
                <th className="py-1.5 px-1 text-right font-medium">KP</th>
                <th className="py-1.5 px-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <InventoryRow name="Automatic Weather Station (AWS)" gb={21} kp={17} total={38} />
              <InventoryRow name="Lake Level Gauge (WLL)" gb={20} kp={8} total={28} />
              <InventoryRow name="River Level Gauge (WLR)" gb={34} kp={15} total={49} />
              <InventoryRow name="Discharge Gauge (DG)" gb={26} kp={10} total={36} />
              <InventoryRow name="Automatic Rain Gauge (ARG)" gb={58} kp={22} total={80} />
              <InventoryRow name="Warning Post (WP)" gb={35} kp={13} total={48} />
            </tbody>
          </table>
        </div>
        <P>
          Sensor package cost is approximately <K>USD 1.9 million</K>, around{' '}
          <K>5.2%</K> of total project cost. Per-asset cost varies by sensor
          type, telemetry method, civil works, and site accessibility.
        </P>
      </>
    ),
  },
  {
    id: 'akah',
    title: 'AKAH Network',
    searchable:
      'AKAH Aga Khan Agency for Habitat community weather monitoring early warning systems 65 sensors GB KP volunteers preparedness',
    body: (
      <>
        <P>
          The <K>Aga Khan Agency for Habitat</K> works on disaster
          preparedness, habitat safety, community resilience, and early warning
          systems in vulnerable mountain communities. Its systems are strongly
          community-oriented and linked with trained volunteers, maintenance
          support, and practical warning dissemination.
        </P>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Stat value="65" label="sensors across GB & KP" />
        </div>
        <SubHead>Asset types</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Weather Monitoring Platforms</Bullet>
          <Bullet>Automatic Weather Stations</Bullet>
          <Bullet>Real-time Early Warning Systems</Bullet>
        </ul>
        <SubHead>Functionality</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Local weather, rainfall, snow, and wind observation.</Bullet>
          <Bullet>Community risk advisories and volunteer-run operations.</Bullet>
          <Bullet>
            Hazard-specific preparedness for flood, avalanche, landslide, and
            other mountain risks.
          </Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'wapda',
    title: 'WAPDA GMRC Network',
    searchable:
      'WAPDA GMRC Glacier Monitoring Research Centre high-altitude automatic weather station Upper Indus Basin Jhelum Kabul 20 stations 1993 1997 elevation temperature precipitation humidity wind solar radiation Lahore',
    body: (
      <>
        <P>
          The <K>WAPDA Glacier Monitoring and Research Centre</K> operates
          high-altitude hydrometeorological stations in the Upper Indus Basin
          and related catchments. Its mandate is scientific and water-resource
          oriented — supporting glacier, climate, runoff, and basin-scale
          analysis.
        </P>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Stat value="20" label="AWS total" />
          <Stat value="12" label="Indus" />
          <Stat value="4" label="Jhelum" />
          <Stat value="4" label="Kabul" />
        </div>
        <SubHead>Network profile</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>
            Period: <K>1993 – 1997</K> establishment onwards.
          </Bullet>
          <Bullet>
            Elevation range: <K>1,479 – 4,730 m.a.s.l.</K>
          </Bullet>
          <Bullet>
            Parameters: temperature, precipitation, relative humidity, wind
            speed, wind direction, wind gust, solar radiation.
          </Bullet>
          <Bullet>Data receiving centre: Lahore.</Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'aws',
    title: 'Automatic Weather Station (AWS)',
    searchable:
      'AWS automatic weather station temperature humidity rainfall wind speed direction pressure solar radiation battery voltage communication',
    body: (
      <>
        <P>
          A field-based system that collects meteorological observations from
          remote mountain sites — sensors, data logger, mast, solar power,
          enclosure, and telemetry.
        </P>
        <SubHead>Typical parameters</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Air temperature, relative humidity, pressure.</Bullet>
          <Bullet>Rainfall, wind speed, wind direction.</Bullet>
          <Bullet>Solar radiation, battery voltage, comms health.</Bullet>
        </ul>
        <SubHead>Operational role</SubHead>
        <P>
          Supports weather monitoring in high-risk valleys, rainfall-threshold
          alerts, and context for GLOF, landslide, flash-flood, and debris-flow
          risk.
        </P>
      </>
    ),
  },
  {
    id: 'lake-gauge',
    title: 'Lake Level Gauge (WLL)',
    searchable:
      'lake level gauge WLL water level glacial outburst threshold sudden rise drawdown moraine instability',
    body: (
      <>
        <P>
          Measures the water level of a glacial lake. Critical for detecting
          abnormal filling, sudden drawdown, or rapid rise — early indicators
          of overtopping, ice / debris movement, or partial breach.
        </P>
        <SubHead>Tracked values</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Current lake level &amp; rate of rise / fall.</Bullet>
          <Bullet>
            Threshold exceedance: <K>watch</K> → <K>warning</K> →{' '}
            <K>critical</K>.
          </Bullet>
          <Bullet>Sensor health and comms status.</Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'river-gauge',
    title: 'River Level Gauge (WLR)',
    searchable:
      'river level gauge WLR water stage flood early warning rainfall runoff snowmelt outburst flow blockage release debris flow',
    body: (
      <>
        <P>
          Measures stage or water level in a river, stream, or downstream
          channel. Rapid level increase can signal rainfall-runoff response,
          snowmelt contribution, GLOF flow, or blockage release.
        </P>
        <SubHead>Operational role</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Flood warning for downstream settlements.</Bullet>
          <Bullet>Validating forecasts and threshold-based decisions.</Bullet>
          <Bullet>Field observation feed for hydrological models.</Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'discharge-gauge',
    title: 'Discharge Gauge (DG)',
    searchable:
      'discharge gauge DG flow rate velocity rating curve cross-section calibration flood magnitude downstream impact',
    body: (
      <>
        <P>
          Measures or estimates the flow rate of a river or stream. Discharge
          links more directly to flood magnitude than stage alone, but requires
          <K> rating curves</K>, velocity measurements, and periodic
          calibration.
        </P>
        <SubHead>Why it matters</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Distinguishes normal high flow from dangerous flood.</Bullet>
          <Bullet>Calibrates hydrological models and forecast skill.</Bullet>
          <Bullet>Supports post-event analysis and flood-class scoring.</Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'rain-gauge',
    title: 'Automatic Rain Gauge (ARG)',
    searchable:
      'automatic rain gauge ARG rainfall intensity accumulation 1hr 3hr 6hr 24hr flash flood landslide convective',
    body: (
      <>
        <P>
          Measures rainfall intensity and accumulation. Essential for flash
          flood forecasting, slope-failure risk, debris-flow monitoring, and
          GLOF trigger assessment.
        </P>
        <SubHead>Accumulation windows</SubHead>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Stat value="1h" />
          <Stat value="3h" />
          <Stat value="6h" />
          <Stat value="24h" />
        </div>
        <P>
          Threshold breaches in shorter windows often precede flash-flood and
          debris-flow events in steep valleys.
        </P>
      </>
    ),
  },
  {
    id: 'warning-post',
    title: 'Warning Post (WP)',
    searchable:
      'warning post WP siren beacon alert public announcement community evacuation last mile manual activation solar battery caretaker',
    body: (
      <>
        <P>
          Field-based community alert facility — siren, beacon light, public
          announcement system, comms unit, solar / battery power, and a manual
          activation option. Critical where mobile network coverage is weak.
        </P>
        <SubHead>Role</SubHead>
        <ul className="space-y-1 mt-1">
          <Bullet>Last-mile warning to exposed communities.</Bullet>
          <Bullet>Evacuation alerting during GLOFs and flash floods.</Bullet>
          <Bullet>Redundancy when mobile networks fail.</Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'status-classification',
    title: 'Operational Status Reference',
    searchable:
      'operational status classification online offline delayed under maintenance damaged not commissioned planned data access pending',
    body: (
      <>
        <P>
          Stations are classified into the following operational states for
          dashboard health monitoring:
        </P>
        <ul className="space-y-1 mt-1">
          <Bullet>
            <K>Operational</K> — transmitting valid data within the expected
            reporting interval.
          </Bullet>
          <Bullet>
            <K>Delayed</K> — data received, but later than expected.
          </Bullet>
          <Bullet>
            <K>Offline</K> — no data beyond accepted delay threshold.
          </Bullet>
          <Bullet>
            <K>Under Maintenance</K> — temporarily unavailable for repair,
            inspection, or calibration.
          </Bullet>
          <Bullet>
            <K>Damaged</K> — confirmed physical or technical damage.
          </Bullet>
          <Bullet>
            <K>Not Commissioned</K> — installed but not yet operational.
          </Bullet>
          <Bullet>
            <K>Planned</K> / <K>Data Access Pending</K> — installation or
            integration not yet complete.
          </Bullet>
        </ul>
      </>
    ),
  },
  {
    id: 'alert-levels',
    title: 'Alert Level Reference',
    searchable:
      'alert level classification normal watch warning critical post-event evacuation hazard threshold',
    body: (
      <>
        <P>
          Hazard alert levels drive the dashboard's warning indicators and the
          recommended downstream actions:
        </P>
        <ul className="space-y-1 mt-1">
          <Bullet>
            <K>Normal</K> — no abnormal condition; continue routine monitoring.
          </Bullet>
          <Bullet>
            <K>Watch</K> — conditions becoming favourable for hazard
            development. Increase monitoring and inform authorities.
          </Bullet>
          <Bullet>
            <K>Warning</K> — threshold exceeded or hazard likelihood is high.
            Activate district coordination and prepare community warning.
          </Bullet>
          <Bullet>
            <K>Critical</K> — rapidly worsening or imminent threat. Activate
            warning posts, evacuation routes, and emergency response.
          </Bullet>
          <Bullet>
            <K>Post-Event Monitoring</K> — hazard has occurred or warning
            withdrawn. Conduct damage assessment and sensor inspection.
          </Bullet>
        </ul>
      </>
    ),
  },
];

export default function SensorsInfoPanel() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.searchable.toLowerCase().includes(q),
    );
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-day-muted dark:text-night-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sensors info…"
          className={cn(
            'w-full pl-7 pr-7 py-1.5 text-[12px] rounded-md',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text',
            'placeholder:text-day-muted dark:placeholder:text-night-muted',
            'focus:outline-none focus:ring-1 focus:ring-[#16a085]',
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-[12px] text-day-muted dark:text-night-muted text-center py-8">
          No matching sections.
        </p>
      ) : (
        <div className="space-y-4 pb-2">
          {visible.map((section) => (
            <section
              key={section.id}
              className={cn(
                'rounded-md border border-day-border dark:border-night-border',
                'bg-day-bg/40 dark:bg-night-bg/40 p-3 space-y-2',
              )}
            >
              <h3 className="text-[13px] font-semibold text-day-text dark:text-night-text">
                {section.title}
              </h3>
              {section.body}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
