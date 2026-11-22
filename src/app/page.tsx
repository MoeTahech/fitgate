import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
        Your gym, without the front-desk queue.
      </h1>
      <p className="mt-4 max-w-lg text-lg text-zinc-600 dark:text-zinc-400">
        Manage your membership, check in with your phone, and book classes in seconds.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/sign-up"
          className="rounded-md bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Create an account
        </Link>
        <Link
          href="/sign-in"
          className="rounded-md border border-zinc-300 px-5 py-3 font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
