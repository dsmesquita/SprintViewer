/** Images imported by the renderer resolve to the URL Vite serves them from. */
declare module '*.png' {
  const url: string
  export default url
}
