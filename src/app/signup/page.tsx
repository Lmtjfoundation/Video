import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create account · Vueio" };
export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
