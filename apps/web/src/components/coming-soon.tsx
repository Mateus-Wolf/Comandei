export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SEU ESPAÇO</span>
          <h1>{title}</h1>
        </div>
      </div>
      <section className="empty-state">
        <h2>Em breve, por aqui</h2>
        <p>Esta área será desenvolvida nas próximas etapas.</p>
      </section>
    </>
  );
}
