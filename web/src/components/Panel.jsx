export default function Panel({ title, right, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {right != null && <span className="panel-right">{right}</span>}
      </header>
      {children}
    </section>
  );
}
