import { requirePermission } from "@/lib/auth/session";
import { ProjectForm } from "../form";

export default async function NewProjectPage() {
  await requirePermission("projects.edit");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="page-title">Add a project</h1>
      <ProjectForm />
    </div>
  );
}
