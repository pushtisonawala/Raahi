'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, MapPin } from 'lucide-react'
import { searchPlaces, type GeocodedPlace } from '@/lib/route'

type PlaceAutocompleteProps = {
  label: string
  value: string
  placeholder: string
  onValueChange: (value: string) => void
  onSelect: (place: GeocodedPlace) => void
}

export function PlaceAutocomplete({
  label,
  value,
  placeholder,
  onValueChange,
  onSelect,
}: PlaceAutocompleteProps) {
  const listboxId = useId()
  const requestIdRef = useRef(0)
  const [suggestions, setSuggestions] = useState<GeocodedPlace[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 3) {
      setSuggestions([])
      setLoading(false)
      return
    }

    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const places = await searchPlaces(query, controller.signal)
        if (requestId !== requestIdRef.current) return
        setSuggestions(places)
        setActiveIndex(-1)
        setOpen(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (requestId === requestIdRef.current) setSuggestions([])
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, 350)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  const selectPlace = (place: GeocodedPlace) => {
    onSelect(place)
    setSuggestions([])
    setOpen(false)
    setActiveIndex(-1)
  }

  return (
    <div className="relative">
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <MapPin
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (!open || suggestions.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) =>
                current <= 0 ? suggestions.length - 1 : current - 1
              )
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault()
              selectPlace(suggestions[activeIndex])
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-beacon-amber"
        />
        {loading && (
          <LoaderCircle
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg"
        >
          {suggestions.map((place, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={place.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault()
                selectPlace(place)
              }}
              className={`flex w-full items-start gap-2 px-3 py-3 text-left text-sm hover:bg-muted ${
                index === activeIndex ? 'bg-muted' : ''
              }`}
            >
              <MapPin size={16} className="mt-0.5 shrink-0 text-beacon-amber" />
              <span className="line-clamp-2 text-foreground">{place.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
