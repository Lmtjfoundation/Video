export const metadata = { title: "Offline · Nexus Pulse" };

export default function Offline() {
  return (
    <div className="relative z-10 grid min-h-screen place-items-center px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-white">You're offline</h1>
        <p className="mt-2 text-white/60">Nexus Pulse needs a connection. Your scheduled posts keep publishing from the server while you're away.</p>
      </div>
    </div>
  );
}
