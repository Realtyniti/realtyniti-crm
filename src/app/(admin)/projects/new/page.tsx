import { ProjectForm } from "../form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Add a project</h1>
      <ProjectForm />
    </div>
  );
}
