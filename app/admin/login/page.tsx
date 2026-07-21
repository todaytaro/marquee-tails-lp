import { LoginForm } from "./LoginForm";

export const metadata = {
  title: "管理者ログイン — Marquee Tails",
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-10">
      <header className="mb-8 text-center">
        <h1 className="font-display text-4xl tracking-wide text-ivory">
          MARQUEE TAILS
        </h1>
        <p className="mt-1 text-sm text-muted">管理者ログイン</p>
      </header>

      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-6 py-8">
        <LoginForm />
      </div>
    </main>
  );
}
