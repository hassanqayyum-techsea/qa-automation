import { Button } from "@your-job-search-genius/odyssey-ui/components/base/buttons/button";
import { Empty } from "~/app/ui/empty";

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Empty
        icon="Shield01"
        color="warning"
        title="Your role doesn't include this page"
        description="Ask an Owner to add the permission to your role if you need it."
        actions={
          <>
            <Button href="/apps" color="secondary" size="md">Go to tests</Button>
            <Button href="/" size="md">Go to dashboard</Button>
          </>
        }
      />
    </main>
  );
}
