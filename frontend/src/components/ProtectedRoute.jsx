import { Navigate } from "react-router-dom";

import { useAuth } from "../context/useAuth.js";

export default function ProtectedRoute({ children }) {
  const { user, booting } = useAuth();

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-mist px-4 text-ink">
        <div className="surface w-full max-w-sm p-6 text-center">
          <div className="mx-auto mb-4 h-2 w-28 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/2 rounded-full bg-sea" />
          </div>
          <p className="text-sm font-semibold">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
