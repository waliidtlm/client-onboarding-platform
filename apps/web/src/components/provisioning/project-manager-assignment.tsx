import { assignProjectManagerAction } from "@/app/(dashboard)/onboardings/actions";

export function ProjectManagerAssignment({
  onboardingId,
  version,
  currentProjectManagerId,
  projectManagers,
}: Readonly<{
  onboardingId: string;
  version: number;
  currentProjectManagerId: string | null;
  projectManagers: readonly Readonly<{ id: string; name: string; email: string }>[];
}>) {
  return (
    <form action={assignProjectManagerAction} className="inline-form compact-form">
      <input type="hidden" name="onboardingId" value={onboardingId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <label>
        Active Project Manager
        <select name="projectManagerId" defaultValue={currentProjectManagerId ?? ""} required>
          <option value="" disabled>
            Select a Project Manager
          </option>
          {projectManagers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name} — {manager.email}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Assign Project Manager</button>
    </form>
  );
}
