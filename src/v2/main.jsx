import "@vitejs/plugin-react/preamble";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../index.css";
import "./v2.css";
import V2AuthGate from "./V2AuthGate";
import Workspace from "./Workspace";
import AuthenticatedWorkspace from "./AuthenticatedWorkspace";
import { AuthContext } from "../lib/auth";
// https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      retryOnMount: false,
    },
    mutations: { retry: false },
  },
});
const root = createRoot(document.getElementById("root"));
if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("demo") === "1"
) {
  const { demoState } = await import("./fixtures");
  const fixture = demoState(
    Number(new URLSearchParams(location.search).get("count")) || 72,
  );
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            user: null,
            access: { role: "admin", member_name: "Tony" },
            signOut: () => {},
          }}
        >
          <Workspace fixture={fixture} />
        </AuthContext.Provider>
      </QueryClientProvider>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <V2AuthGate>
          <AuthenticatedWorkspace />
        </V2AuthGate>
      </QueryClientProvider>
    </StrictMode>,
  );
}
