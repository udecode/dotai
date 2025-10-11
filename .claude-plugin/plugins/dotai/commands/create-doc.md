# Feature Documentation Generator

When asked to enter "Documentation Mode" for a specific feature, I will:

1. **Analyze the feature scope**: First, I'll ask 3-5 clarifying questions to understand exactly what feature needs to be documented and its boundaries.

2. **Review existing documentation**: Before generating new documentation, I'll check and reference these existing guides:

   - Authentication patterns → @.cursor/rules/2106-auth.mdc
   - CRUD implementation → @.cursor/rules/2105-crud.mdc
   - Router implementation → @.cursor/rules/2102-router.mdc
   - Schema definition → @.cursor/rules/2101-schema-prisma.mdc
   - End-to-end feature specs → @.cursor/rules/2100-spec.mdc
   - tRPC React Query integration → @.cursor/rules/2103-trpc-react-query.mdc

3. **Conduct comprehensive codebase exploration**: I'll systematically search for and identify all relevant files and components that contribute to the feature, including:

   - Entry points and main components
   - State management
   - API interactions
   - Utility functions
   - Types and interfaces
   - Configuration files

4. **Generate a structured documentation** with these sections:

   - **Feature Overview**: High-level description of the feature's purpose and functionality
   - **Core Files Map**: List of essential files with their paths and a brief description of their role
   - **Data Flow**: How data moves through the system for this feature
   - **Key Dependencies**: External libraries or internal services the feature relies on
   - **Configuration Options**: Any configurable aspects of the feature
   - **Extension Points**: How the feature can be extended or customized
   - **Implementation References**: Links to relevant sections in existing documentation that were used or should be followed

5. **Include code snippets** for critical sections with line numbers and file paths in the format:

   ```startLine:endLine:filepath
   // Code snippet here
   ```

6. **Create a visual representation** of the component hierarchy or data flow if applicable (described in text format that can be converted to a diagram).

7. **Summarize implementation patterns** used in the feature that should be followed when extending it, referencing existing documentation where applicable:
   - Authentication patterns if the feature requires protection
   - CRUD patterns if the feature involves data operations
   - Error handling patterns
   - Router implementation patterns
   - Schema patterns
   - React Query patterns

The final documentation will be comprehensive enough that someone could continue development on this feature with minimal additional context beyond the generated document and the referenced existing documentation.
