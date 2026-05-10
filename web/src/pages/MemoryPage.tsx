import MemoryPanel from "../features/memory/MemoryPanel";
import { PageScaffold } from "../components/common/PageScaffold";

export default function MemoryPage() {
  return (
    <PageScaffold width="full">
      <MemoryPanel variant="page" />
    </PageScaffold>
  );
}
