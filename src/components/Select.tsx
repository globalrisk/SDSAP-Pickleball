import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'

type OptionProps = ComponentPropsWithoutRef<'option'>
type SelectProps = Omit<ComponentPropsWithoutRef<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children'> & {
  value?: string | number
  defaultValue?: string | number
  onValueChange: (value: string) => void
  required?: boolean
  children: ReactNode
}

export function Select({ children, value, defaultValue, onValueChange, disabled, required, name, className = '', ...props }: SelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child) || child.type !== 'option') return []
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: child.props.disabled }]
  })
  const placeholder = options.find((option) => option.value === '')?.label

  return <SelectPrimitive.Root
    value={value == null ? undefined : String(value)}
    defaultValue={defaultValue == null ? undefined : String(defaultValue)}
    onValueChange={(next) => onValueChange(next === '__empty__' ? '' : next)} disabled={disabled} required={required} name={name}
  >
    <SelectPrimitive.Trigger {...props}
      className={`group inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-green-200 bg-white px-3 py-2 text-left text-sm font-semibold text-green-900 shadow-sm transition-colors hover:border-green-400 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-green-600 data-[state=open]:ring-2 data-[state=open]:ring-green-100 ${className}`}
    >
      <span className="min-w-0 truncate"><SelectPrimitive.Value placeholder={placeholder} /></span>
      <SelectPrimitive.Icon className="shrink-0 text-green-600 transition-transform group-data-[state=open]:rotate-180">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" sideOffset={6} collisionPadding={12}
        className="themed-popover z-[80] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-green-200 bg-white p-1.5 text-green-950 shadow-xl shadow-green-950/15"
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-green-700">▴</SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport>
          {options.map((option) => <SelectPrimitive.Item key={option.value} value={option.value || '__empty__'} disabled={option.disabled}
            className="relative flex min-h-11 cursor-pointer select-none items-center rounded-xl py-2.5 pr-10 pl-3 text-sm font-medium outline-none data-[highlighted]:bg-green-50 data-[highlighted]:text-green-900 data-[state=checked]:bg-green-100 data-[state=checked]:font-bold data-[state=checked]:text-green-800 data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          >
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="absolute right-3 text-green-700">
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
            </SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-green-700">▾</SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
