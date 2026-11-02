import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Heading } from "@your-job-search-genius/odyssey-ui/components/base/typography/heading";
import { Body1 } from "@your-job-search-genius/odyssey-ui/components/base/typography/body-1";
import { LoadingIndicator } from "@your-job-search-genius/odyssey-ui/components/application/loading-indicator/loading-indicator";
import { col, dbReady } from "~/lib/db";
import { getUser } from "~/lib/auth";
import { LoginForm, OwnerForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <section className="flex w-full max-w-sm flex-col gap-8">
        <Suspense fallback={<LoadingIndicator type="line-simple" size="md" label="Loading" />}>
          <LoginOrSetup />
        </Suspense>
      </section>
    </main>
  );
}

async function LoginOrSetup() {
  if (await getUser()) redirect("/");
  await dbReady();
  const firstRun = (await col.users.countDocuments({}, { limit: 1 })) === 0;
  return firstRun ? (
    <>
      <header className="flex flex-col gap-2">
        <Heading level={1} size={3}>Create the owner account</Heading>
        <Body1>No one has signed in yet. The first account becomes the Owner and can add everyone else.</Body1>
      </header>
      <OwnerForm />
    </>
  ) : (
    <>
      <header className="flex flex-col gap-2">
        <Heading level={1} size={3}>Sign in to Repo Pulse</Heading>
        <Body1>Accounts are created by your Owner. Ask them if you need access or a password reset.</Body1>
      </header>
      <LoginForm />
    </>
  );
}
