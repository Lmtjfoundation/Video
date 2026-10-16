import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · Ghost Post" };
export default function LoginPage() {
  return <AuthForm mode="login" />;
}
