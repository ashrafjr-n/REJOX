import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the header', () => {
  render(<App />)
  expect(screen.getByText(/Plain JS App/i)).toBeInTheDocument()
})
