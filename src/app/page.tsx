import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Your gym, without the front-desk queue.
      </h1>
      <p className="mt-4 max-w-lg text-lg text-muted-foreground">
        Manage your membership, check in with your phone, and book classes in seconds.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
          Create an account
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
