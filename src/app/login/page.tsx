import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · Nexus Pulse" };
export default function LoginPage() {
  return <AuthForm mode="login" />;
}
