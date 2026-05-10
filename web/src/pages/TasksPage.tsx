import { RuntimeSummary } from "../features/runtime/RuntimeSummary";
import { PageScaffold } from "../components/common/PageScaffold";

export default function TasksPage() {
  return (
    <PageScaffold>
      <RuntimeSummary mode="tasks" />
    </PageScaffold>
  );
}
