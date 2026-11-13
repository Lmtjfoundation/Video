import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create account · Curbvue" };
export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
