import { useState } from 'react'

const Counter = () => {
  const [count, setCount] = useState(0)

  return (
    <section className='mt-8 flex flex-col gap-2'>
      <p className='text-sm text-gray-600'>Count: {count}</p>
      <button type='button' onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </section>
  )
}

export default Counter
