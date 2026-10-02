/**
 * Residue no rule resolves: `group` and an arbitrary animation reach the LLM
 * tier (or stay residue when AI is disabled). The gradient is resolved by a
 * rule, but still owes a <LinearGradient> a human has to write.
 */
export default function App() {
  return (
    <div className="p-4 group animate-[wiggle_1s]">
      <section className="bg-gradient-to-r from-indigo-600 to-violet-600 p-8">
        <p>Hello</p>
      </section>
    </div>
  );
}
