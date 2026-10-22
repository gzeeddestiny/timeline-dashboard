import { useAuth } from "../lib/auth";
import Workspace from "./Workspace";
export default function AuthenticatedWorkspace() {
  const { user } = useAuth();
  return <Workspace key={user?.id || "local"} />;
}
