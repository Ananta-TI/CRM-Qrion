/**
 * Instant navigation feedback. The shell (sidebar + header) stays mounted;
 * only this content area is replaced by the skeleton while the next page's
 * server data streams in.
 */
export default function AppLoading() {
  return (
    <div className="stack" role="status" aria-busy="true">
      <span className="sr-only">Memuat halaman…</span>

      <div className="grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div className="card" key={i}>
            <div className="skel" style={{ width: "45%", height: 12 }} />
            <div className="skel mt-2" style={{ width: "55%", height: 28 }} />
            <div className="skel mt-2" style={{ width: "75%", height: 10 }} />
          </div>
        ))}
      </div>

      <div className="stack" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <section className="card" key={i}>
            <div className="row row--between">
              <div className="skel" style={{ width: 100, height: 10 }} />
              <div className="skel" style={{ width: 70, height: 18 }} />
            </div>
            <div className="skel mt-2" style={{ width: "60%", height: 20 }} />
            <div className="skel mt-2" style={{ width: "100%", height: 10 }} />
            <div className="skel mt-2" style={{ width: "85%", height: 10 }} />
          </section>
        ))}
      </div>
    </div>
  );
}
