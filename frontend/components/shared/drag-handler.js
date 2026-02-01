/**
 * Create a drag handler configuration object
 * Used to standardize drag/drop behavior across components
 * @param {Object} config - Configuration object
 * @returns {Object} Drag handler methods
 */
export function createDragHandler(config) {
  const {
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    dragDataType = 'text/plain',
  } = config;

  return {
    handleDragStart: (event, data) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(dragDataType, JSON.stringify(data));
      if (onDragStart) onDragStart(event, data);
    },

    handleDragOver: (event, target) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (onDragOver) onDragOver(event, target);
    },

    handleDragLeave: (event) => {
      if (onDragLeave) onDragLeave(event);
    },

    handleDrop: (event, target) => {
      event.preventDefault();
      const dataStr = event.dataTransfer.getData(dragDataType);
      if (dataStr) {
        try {
          const data = JSON.parse(dataStr);
          if (onDrop) onDrop(event, target, data);
        } catch (error) {
          console.error('Error parsing drop data:', error);
        }
      }
    },
  };
}
