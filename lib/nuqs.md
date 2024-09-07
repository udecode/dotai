# Using nuqs for URL Query State Management

`nuqs` is used for managing URL query state in Next.js applications. Follow these guidelines when working with it:

1. Import necessary functions from `nuqs`:

   ```typescript
   import { parseAsBoolean, parseAsStringEnum, useQueryState } from 'nuqs';
   ```

2. Create a custom hook for each query parameter:

   ```typescript
   export const useMyParameterState = () => {
     return useQueryState(
       'parameterName',
       parseAsStringEnum(['option1', 'option2'])
         .withDefault('option1')
         .withOptions({ history: 'push' })
     );
   };
   ```

3. Use history push if you think the user will want to navigate back to the previous state:

   ```typescript
   export const useBooleanState = () => {
     return useQueryState(
       'boolParam',
       parseAsBoolean.withDefault(false).withOptions({
         history: 'push',
       })
     );
   };
   ```

4. Use the custom hooks in your components:

   ```typescript
   const [value, setValue] = useMyParameterState();
   ```

5. Update the URL query when changing values:

   ```typescript
   void setValue('newValue');
   ```

6. Use `clearOnDefault` option to remove the parameter from the URL when it's set to its default value:

   ```typescript
   export const useConfigurationItemsState = () => {
     return useQueryState(
       'configItems',
       parseAsJson<Record<string, string>>().withDefault({}).withOptions({
         clearOnDefault: true,
         history: 'push',
       })
     );
   };
   ```

   This ensures that empty or default values are not included in the URL search params, keeping the URL clean and only including relevant information.

Remember to define your query state hooks in a central location (e.g., `useQueryState.ts`) for easy reuse across your application.

Reference: `apps/web/src/lib/navigation/useQueryState.ts`
