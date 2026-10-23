import { useEffect } from "react";
import FitAIStudio from "./components/FitAIStudio/FitAIStudio.jsx";

// body[data-task] is used by styles/base.css for this task's page background.
const TASK_ID = "17";

export default function App() {
  useEffect(() => {
    document.body.dataset.task = TASK_ID;
    return () => { delete document.body.dataset.task; };
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <span className="task-chip">Task 17</span>
        <h1 className="page-title">FitAI Studio</h1>
        <p className="page-sub">Build a body profile or estimate measurements from an optional photo, preview clothing in 3D, explore fabrics, and compare fit recommendations.</p>
      </div>
      <FitAIStudio />
    </main>
  );
}
