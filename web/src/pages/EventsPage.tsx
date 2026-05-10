import { RuntimeSummary } from "../features/runtime/RuntimeSummary";
import { PageScaffold } from "../components/common/PageScaffold";

export default function EventsPage() {
  return (
    <PageScaffold>
      <RuntimeSummary mode="events" />
    </PageScaffold>
  );
}
